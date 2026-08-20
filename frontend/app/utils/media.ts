import { handleApiError } from '~/utils/apiError';
import { buildSentencePath } from '~/utils/routes';

type ConcatenatedAudio = {
  blob: Blob;
  blob_url: string;
  /**
   * True when at least one object only arrived after the cache-bypassing retry
   * below -- i.e. this reader's cache was poisoned and self-healed.
   */
  cacheBypassed: boolean;
};

/**
 * How far an audio segment request got.
 *
 * `http` means the server answered and we rejected the status. `opaque` means
 * `fetch` itself rejected, and that is the case worth separating: a CORS
 * rejection, a DNS failure, an offline tab and an extension-blocked request are
 * ONE indistinguishable `TypeError: Failed to fetch` to page script, with no
 * status, no headers and no URL on the error.
 */
export type AudioFetchFailureKind = 'http' | 'opaque';

/**
 * A failed audio segment request that still knows WHICH url failed.
 *
 * `concatenateAudios` used to rethrow the raw rejection, so every report of a
 * failed expansion reached error tracking as a bare `Failed to fetch` naming
 * neither the object nor the CDN. That is the whole reason issue #194
 * ("Expand context doesn't work") survived months of investigation: the reports
 * carried nothing to act on.
 */
export class AudioFetchError extends Error {
  readonly url: string;
  readonly kind: AudioFetchFailureKind;
  readonly status?: number;

  constructor(url: string, kind: AudioFetchFailureKind, status?: number, options?: ErrorOptions) {
    // The url stays OUT of the message and in a property: it is the part that
    // varies, and interpolating it would fingerprint every object separately and
    // scatter one fault across an issue per segment.
    super(
      kind === 'http'
        ? `Audio segment request failed with status ${status}`
        : 'Audio segment request failed before a response arrived',
      options,
    );
    this.name = 'AudioFetchError';
    this.url = url;
    this.kind = kind;
    this.status = status;
  }
}

/** How long the follow-up probe below may take before we stop waiting on it. */
const AUDIO_PROBE_TIMEOUT_MS = 3_000;

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return 'unparseable';
  }
}

/**
 * Attributes describing an audio fetch failure, for `reportError`.
 *
 * For an `opaque` failure this re-requests the same url with `mode: 'no-cors'`,
 * which is the only way page script can tell the possibilities apart: that
 * request skips the CORS check entirely, so it resolves whenever the object is
 * actually reachable. Resolving therefore means the object was there and the
 * ORIGINAL request was refused over CORS -- missing or mismatched headers on the
 * CDN response, which is exactly the question left open on issue #194. Rejecting
 * means the host could not be reached at all.
 *
 * The probe is deliberately only on the already-failed path, and its own failure
 * is never allowed to mask the original error.
 */
export async function describeAudioFetchFailure(error: unknown): Promise<Record<string, string>> {
  if (!(error instanceof AudioFetchError)) return {};

  const attributes: Record<string, string> = {
    'audio.url': error.url,
    'audio.host': hostOf(error.url),
    'audio.failure': error.kind,
  };

  if (error.status !== undefined) {
    attributes['http.status_code'] = String(error.status);
  }

  if (error.kind !== 'opaque') return attributes;

  // Checked before the probe: an offline tab explains the rejection on its own,
  // and probing would just fail a second time and report the wrong cause.
  if (navigator.onLine === false) {
    attributes['audio.opaque_cause'] = 'offline';
    return attributes;
  }

  const signal =
    typeof AbortSignal !== 'undefined' && 'timeout' in AbortSignal
      ? AbortSignal.timeout(AUDIO_PROBE_TIMEOUT_MS)
      : undefined;

  try {
    await fetch(error.url, { method: 'HEAD', mode: 'no-cors', cache: 'no-store', signal });
    attributes['audio.opaque_cause'] = 'cors';
  } catch {
    attributes['audio.opaque_cause'] = signal?.aborted ? 'probe-timeout' : 'unreachable';
  }

  return attributes;
}

/**
 * Fetch one audio object for concatenation, retrying past a poisoned cache entry.
 *
 * The player builds its elements with `new Audio(url)`, and a media element's
 * request is not a CORS request. Chromium stores that response under the same
 * cache key this CORS-mode `fetch` uses and then refuses to hand it back, so
 * expanding a segment the reader had already PLAYED rejected with a bare
 * `TypeError: Failed to fetch`, while the very same segment expanded fine when it
 * had not been played yet. That order-dependence is issue #194's "sometimes it
 * works", and it is why expanded audio silently fell back to the original clip in
 * both the player and the Anki export.
 *
 * The fix belongs on THIS side rather than on the media element. Setting
 * `crossOrigin` there would stop the poisoning at the source, but it would make
 * playing anything at all contingent on the CDN's CORS policy -- see the note in
 * `stores/player.ts`. `cache: 'reload'` skips the cache for this request alone,
 * costs one re-download of a ~17KB clip when the entry turns out to be poisoned,
 * and cannot take playback down with it.
 *
 * Widening the bucket's CORS policy does NOT remove the need for this, which is
 * worth stating because it looks like it should: the poisoning is about the
 * media element's request not being a CORS request, not about which origins the
 * response allows. Re-tested in a browser after the policy was widened to `*` on
 * 2026-08-13 -- the failure reproduced unchanged.
 */
export async function fetchAudioSegment(url: string): Promise<{ response: Response; cacheBypassed: boolean }> {
  let firstFailure: unknown;
  try {
    const response = await fetch(url);
    if (response.ok) return { response, cacheBypassed: false };
    // A status is a real answer from the CDN; retrying past the cache cannot
    // change it, so it is reported as-is.
    throw new AudioFetchError(url, 'http', response.status);
  } catch (cause) {
    if (cause instanceof AudioFetchError) throw cause;
    firstFailure = cause;
  }

  try {
    const response = await fetch(url, { cache: 'reload' });
    if (!response.ok) throw new AudioFetchError(url, 'http', response.status);
    return { response, cacheBypassed: true };
  } catch (retryCause) {
    if (retryCause instanceof AudioFetchError) throw retryCause;
    // The ORIGINAL rejection is the cause worth keeping: the retry failing the
    // same way says nothing new, and `describeAudioFetchFailure` diagnoses the
    // url either way.
    throw new AudioFetchError(url, 'opaque', undefined, { cause: firstFailure });
  }
}

let audioContext: AudioContext | null;
export async function concatenateAudios(urls: string[]): Promise<ConcatenatedAudio> {
  // https://ccrma.stanford.edu/courses/422-winter-2014/projects/WaveFormat/
  function encodeWAV(samples: Float32Array, channels: number, sampleRate: number): DataView {
    const buffer = new ArrayBuffer(44 + samples.length * 2);
    const view = new DataView(buffer);

    function writeString(view: DataView, offset: number, string: string) {
      for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
      }
    }

    // ChunkID: Contains the letters "RIFF" in ASCII form
    writeString(view, 0, 'RIFF');

    // ChunkSize: 36 + SubChunk2Size
    view.setUint32(4, 36 + samples.length * 2, true);

    // Format: Contains the letters "WAVE"
    writeString(view, 8, 'WAVE');

    // Subchunk1ID: the letters "fmt "
    writeString(view, 12, 'fmt ');

    // Subchunk1Size: 16 for PCM.
    view.setUint32(16, 16, true);

    // AudioFormat: PCM = 1 (i.e. Linear quantization)
    // Values other than 1 indicate some form of compression.
    view.setUint16(20, 1, true);

    // NumChannels: Mono = 1, Stereo = 2, etc
    view.setUint16(22, channels, true);

    // SampleRate: 8000, 44100
    view.setUint32(24, sampleRate, true);

    // ByteRate: == SampleRate * NumChannels * BitsPerSample/8
    view.setUint32(28, sampleRate * channels * 2, true);

    // BlockAlign: == NumChannels * BitsPerSample/8
    view.setUint16(32, channels * 2, true);

    // BitsPerSample: 8 bits = 8, 16 bits = 16, etc.
    view.setUint16(34, 16, true);

    // The "data" subchunk contains the size of the data and the actual sound:

    // Subchunk2ID: Contains the letters "data"
    writeString(view, 36, 'data');

    // Subchunk2Size: == NumSamples * NumChannels * BitsPerSample/8
    view.setUint32(40, samples.length * 2, true);

    // Data: The actual sound data.
    floatTo16BitPCM(view, 44, samples);

    return view;
  }

  function floatTo16BitPCM(view: DataView, offset: number, input: Float32Array) {
    for (let i = 0; i < input.length; i++, offset += 2) {
      const s = Math.max(-1, Math.min(1, input[i] ?? 0));
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    }
  }

  const audioBuffers = [];
  if (!audioContext) {
    audioContext = new AudioContext();
  }

  // `Promise.all` rejects on the first failure and leaves the remaining rejections
  // unowned, so a CDN blip that fails several segments at once surfaces the rest as
  // unhandled rejections — reported as a bare uncaught `Failed to fetch` even though
  // every caller wraps this in try/catch. `allSettled` keeps every rejection owned.
  const settled = await Promise.allSettled(urls.map(fetchAudioSegment));

  const failed = settled.find((result): result is PromiseRejectedResult => result.status === 'rejected');
  if (failed) {
    throw failed.reason instanceof Error ? failed.reason : new Error(String(failed.reason));
  }

  const fetched = settled.filter(
    (result): result is PromiseFulfilledResult<{ response: Response; cacheBypassed: boolean }> =>
      result.status === 'fulfilled',
  );
  const cacheBypassed = fetched.some((result) => result.value.cacheBypassed);
  for (const result of fetched) {
    audioBuffers.push(await audioContext.decodeAudioData(await result.value.response.arrayBuffer()));
  }

  // Should always be 2, but just in case
  const channels = Math.max(...audioBuffers.map((b) => b.numberOfChannels));
  const length = audioBuffers.map((b) => b.length).reduce((a, c) => a + c, 0);
  const firstBuffer = audioBuffers[0];
  if (!firstBuffer) {
    throw new Error('No audio buffers to concatenate');
  }
  const sampleRate = firstBuffer.sampleRate;

  const output = audioContext.createBuffer(channels, length, sampleRate);
  let offset = 0;

  audioBuffers.forEach((buffer) => {
    for (let channelNumber = 0; channelNumber < buffer.numberOfChannels; channelNumber++) {
      output.getChannelData(channelNumber).set(buffer.getChannelData(channelNumber), offset);
    }

    offset += buffer.length;
  });

  // AudioArray/Audiobuffer -> wav
  const interleaved = new Float32Array(length * channels);
  for (let channel = 0; channel < channels; channel++) {
    const channelData = output.getChannelData(channel);
    for (let i = 0; i < length; i++) {
      interleaved[i * channels + channel] = channelData[i] ?? 0;
    }
  }

  const wav = encodeWAV(interleaved, channels, sampleRate);
  const wavArrayBuffer = new ArrayBuffer(wav.byteLength);
  new Uint8Array(wavArrayBuffer).set(new Uint8Array(wav.buffer, wav.byteOffset, wav.byteLength));
  const blob = new Blob([wavArrayBuffer], { type: 'audio/wav' });
  const blobUrl = window.URL.createObjectURL(blob);

  return {
    blob: blob,
    blob_url: blobUrl,
    cacheBypassed,
  };
}

export function downloadAudioOrImage(url: string | URL | Request, filename: string, isBlobUrl = false) {
  const ext = String(filename).split('.').pop()?.toLowerCase();
  const typeMap: Record<string, string> = { mp4: 'video', png: 'image', jpg: 'image', mp3: 'audio', wav: 'audio' };
  const posthog = usePostHog();
  posthog?.capture('segment_downloaded', { download_type: typeMap[ext ?? ''] ?? ext });

  // A signed-out reader saving a clip is the closest thing to a stated intent
  // this site gets: they want to keep the sentence, and an account is how it
  // gets kept properly. Fired here rather than at the four call sites in
  // `SegmentActionsContainer` for the same reason the capture above is -- one of
  // them would eventually be added without it.
  useSignupNudge().nudgeAfterDownload();

  if (isBlobUrl) {
    const a = document.createElement('a');
    a.href = url as string;
    a.download = filename.replace('mp3', 'wav');
    a.click();
    return;
  }

  // Same cache hazard as `fetchAudioSegment`: downloading a clip the reader had
  // just played reused the media element's non-CORS cache entry and rejected as a
  // bare `Failed to fetch`, so the download button looked broken for exactly the
  // segments they were most likely to want.
  fetch(url)
    .catch(() => fetch(url, { cache: 'reload' }))
    .then((response) => {
      if (!response.ok) throw new Error(`Download failed with status ${response.status}`);
      return response.blob();
    })
    .then((blob) => {
      const objectUrl = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.download = filename;
      a.href = objectUrl;
      a.click();
      // Revoking in the same tick can race the browser starting the download,
      // which leaves the user with a click that silently did nothing.
      setTimeout(() => window.URL.revokeObjectURL(objectUrl), 60_000);
    })
    .catch((error: unknown) => {
      handleApiError('media:download-failed', error, {
        toastKey: 'searchpage.main.labels.downloadFailed',
        context: { 'download.filename': filename },
      });
    });
}

export function youtubeWatchUrl(videoId: string, startMs: number): string {
  return `https://www.youtube.com/watch?v=${videoId}&t=${Math.max(0, Math.floor(startMs / 1000))}`;
}

export function youtubeChannelUrl(channelId: string): string {
  return `https://www.youtube.com/channel/${channelId}`;
}

export function anilistAnimeUrl(anilistId: string): string {
  return `https://anilist.co/anime/${anilistId}`;
}

export function imdbTitleUrl(imdbId: string): string {
  return `https://www.imdb.com/title/${imdbId}`;
}

/**
 * TMDB splits movies and series onto different paths. `MOVIE` is the only
 * format that lives under `/movie/`; everything else we catalog (TV, OVA,
 * ONA, specials, J-drama) is a series page.
 */
export function tmdbUrl(tmdbId: string, airingFormat: 'TV' | 'MOVIE' | 'OVA' | 'ONA' | 'SPECIAL' | 'YOUTUBE'): string {
  return `https://www.themoviedb.org/${airingFormat === 'MOVIE' ? 'movie' : 'tv'}/${tmdbId}`;
}

type CatalogExternalIds = {
  anilist?: string | null;
  imdb?: string | null;
  tmdb?: string | null;
  youtube?: string | null;
};

/**
 * Catalog pages that identify the same work, for schema.org `sameAs`.
 *
 * TMDB needs `airingFormat` so the path is `/movie/` or `/tv/` rather than a
 * guess. Without it the id is skipped: a wrong URL is worse than no URL.
 */
export function mediaSameAsUrls(
  media:
    | { externalIds?: CatalogExternalIds | null; airingFormat?: 'TV' | 'MOVIE' | 'OVA' | 'ONA' | 'SPECIAL' | 'YOUTUBE' }
    | null
    | undefined,
): string[] {
  const ids = media?.externalIds;
  const urls: string[] = [];
  if (ids?.anilist) urls.push(anilistAnimeUrl(ids.anilist));
  if (ids?.imdb) urls.push(imdbTitleUrl(ids.imdb));
  if (ids?.tmdb && media?.airingFormat) urls.push(tmdbUrl(ids.tmdb, media.airingFormat));
  if (ids?.youtube) urls.push(youtubeChannelUrl(ids.youtube));
  return urls;
}

const stripHTMLTags = (html: string): string => {
  const div = document.createElement('div');
  div.innerHTML = html;
  return div.textContent || div.innerText || '';
};

/** Copies `item` with its HTML stripped, toasting either outcome. */
export async function copyToClipboard(item: string): Promise<boolean> {
  const { $i18n } = useNuxtApp();
  try {
    await navigator.clipboard.writeText(stripHTMLTags(item));
  } catch (error) {
    // A denied clipboard permission (or a non-secure origin) rejects here, and
    // the button otherwise reads as having worked.
    handleApiError('media:clipboard-copy-failed', error, { toastKey: false });
    useToastError($i18n.t('searchpage.main.labels.errorcopiedcontent'));
    return false;
  }
  useToastSuccess($i18n.t('searchpage.main.labels.copiedcontent'));
  return true;
}

export async function getSharingURL(params: {
  segmentPublicId: string;
  mediaPublicId?: string;
  mediaName?: string;
  japaneseText?: string;
}) {
  const { $i18n } = useNuxtApp();
  try {
    const sentenceUrl = `${window.location.origin}${buildSentencePath(params.segmentPublicId)}`;
    await navigator.clipboard.writeText(sentenceUrl);
    const message = $i18n.t('searchpage.main.labels.copiedsharingurl');
    useToastSuccess(message);

    const posthog = usePostHog();
    posthog?.capture('segment_shared', {
      media_public_id: params.mediaPublicId,
      media_name: params.mediaName,
    });

    const user = userStore();
    if (user.isLoggedIn) {
      const sdk = useNadeshikoSdk();
      sdk
        .trackUserActivity({
          activityType: 'SHARE',
          segmentPublicId: params.segmentPublicId,
          mediaPublicId: params.mediaPublicId,
          mediaName: params.mediaName,
          japaneseText: params.japaneseText,
        })
        .catch(() => {});
    }
  } catch (error) {
    // Same rejections as `copyToClipboard` above -- denied permission, non-secure
    // origin -- but this branch was dropping them on the floor, so a share that
    // never made it to the clipboard was absent from error tracking as well as
    // from `segment_shared`, which only fires on the success path.
    handleApiError('media:share-url-copy-failed', error, { toastKey: false });
    const message = $i18n.t('searchpage.main.labels.errorcopiedsharingurl');
    useToastError(message);
  }
}
