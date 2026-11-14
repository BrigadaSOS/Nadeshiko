import type { Media } from '@brigadasos/nadeshiko-sdk';
import { handleApiError } from '~/utils/apiError';
import { buildSentencePath } from '~/utils/routes';

type AiringFormat = Media['airingFormat'];

type MediaCategory = { category?: string } | null | undefined;

/** Audiobooks are split into chapters; everything else we catalog into episodes. */
export const isAudiobook = (media: MediaCategory): boolean => media?.category === 'AUDIOBOOK';

/** A YouTube channel's "episodes" are its videos. */
export const isYoutube = (media: MediaCategory): boolean => media?.category === 'YOUTUBE';

/** i18n key for "Episode {number}", "Chapter {number}" for audiobooks, or "Video {number}" for YouTube. */
export const episodeLabelKey = (media: MediaCategory): string =>
  isAudiobook(media)
    ? 'searchpage.main.labels.chapter'
    : isYoutube(media)
      ? 'searchpage.main.labels.video'
      : 'searchpage.main.labels.episode';

/** Same unit as `episodeLabelKey`, in the `seo.sentence` namespace (which takes `{n}`). */
export const seoEpisodeLabelKey = (media: MediaCategory): string =>
  isAudiobook(media) ? 'seo.sentence.chapter' : isYoutube(media) ? 'seo.sentence.video' : 'seo.sentence.episode';

/** The English unit the Anki sentence-info field uses: "Chapter", "Video" or "Episode". */
export const episodeUnitName = (media: MediaCategory): string =>
  isAudiobook(media) ? 'Chapter' : isYoutube(media) ? 'Video' : 'Episode';

const KANJI_DIGITS: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };

/** 一..九十九 ("十二", "二十", "三十五"); null for anything else. */
const kanjiNumber = (text: string): number | null => {
  const match = /^([一二三四五六七八九])?(十)?([一二三四五六七八九])?$/.exec(text);
  if (!match || !text) return null;
  const [, tens, ten, ones] = match;
  const digit = (kanji: string | undefined, fallback: number) => (kanji ? (KANJI_DIGITS[kanji] ?? fallback) : fallback);
  if (!ten) return tens && !ones ? digit(tens, 0) : null;
  return digit(tens, 1) * 10 + digit(ones, 0);
};

const toNumber = (digits: string): number | null => {
  const ascii = digits.replace(/[０-９]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0xfee0));
  if (/^\d+$/.test(ascii)) return Number(ascii);
  return kanjiNumber(digits);
};

/** ① for 1, through ㊿ for 50 -- the forms Unicode has; above that, "51.". */
export const circledNumber = (n: number): string => {
  if (n >= 1 && n <= 20) return String.fromCodePoint(0x2460 + n - 1);
  if (n >= 21 && n <= 35) return String.fromCodePoint(0x3251 + n - 21);
  if (n >= 36 && n <= 50) return String.fromCodePoint(0x32b1 + n - 36);
  return `${n}.`;
};

const circledValue = (char: string): number | null => {
  const code = char.codePointAt(0) ?? 0;
  if (code >= 0x2460 && code <= 0x2473) return code - 0x2460 + 1;
  if (code >= 0x3251 && code <= 0x325f) return code - 0x3251 + 21;
  if (code >= 0x32b1 && code <= 0x32bf) return code - 0x32b1 + 36;
  return null;
};

const DIGITS = '[0-9０-９]+|[一二三四五六七八九十]+';
const NUMBERED_TITLE = [
  new RegExp(`^[(（]\\s*(${DIGITS})\\s*[)）]\\s*`), // (1)とにかく…  （１）…
  new RegExp(`^第\\s*(${DIGITS})\\s*[章話回節部巻]\\s*`), // 第1章 … / 第十二話 …
  /^(?:chapter|chap\.?|ch\.?)\s*([0-9]+)\s*[:.\-–—]?\s*/i, // Chapter 3: …
  /^([0-9０-９]+)\s*[.．:：、]\s*/, // 1. …  ２：…
];

/**
 * Splits the book's own numbering off a chapter title: "(1)とにかく…" is
 * { number: 1, name: "とにかく…" }; "あとがき" has no number. The number is the
 * book's, never our episode number -- the episode number is the chapter's
 * position in the audio file, which skips untranscribed tracks (credits, the
 * cast list), so it drifts from the book's numbering.
 */
export const parseChapterTitle = (title: string): { number: number | null; name: string } => {
  const trimmed = title.trim();
  const first = circledValue(trimmed);
  if (first !== null) return { number: first, name: trimmed.slice(1).trim() };
  for (const pattern of NUMBERED_TITLE) {
    const match = pattern.exec(trimmed);
    const number = match?.[1] ? toNumber(match[1]) : null;
    if (match && number !== null) return { number, name: trimmed.slice(match[0].length).trim() };
  }
  return { number: null, name: trimmed };
};

/** A chapter the way the book's table of contents names it: "① とにかく…", or just "あとがき". */
export const bookChapterName = (title: string): string => {
  const { number, name } = parseChapterTitle(title);
  if (number === null) return name;
  return name ? `${circledNumber(number)} ${name}` : circledNumber(number);
};

/**
 * An audiobook chapter with a title is named by it, as the book's contents name
 * it ("① とにかく…", "あとがき"); a YouTube video with a title is named by its
 * title as YouTube shows it -- no chapter parsing, since "EP03-4" in a video
 * title is the channel's numbering, not a book's. The label ("Chapter 4",
 * "Video 4") stays only for entries with no title and for anime and other
 * series, whose episode titles are not reliable enough to replace the number.
 */
export const withChapterTitle = (label: string, media: MediaCategory, title?: string | null): string => {
  const trimmed = title?.trim();
  if (!trimmed) return label;
  if (isAudiobook(media)) return bookChapterName(trimmed);
  if (isYoutube(media)) return trimmed;
  return label;
};

/**
 * "Episode 4"; for an audiobook the chapter as its book names it ("① とにかく…"),
 * and for YouTube the video's title, when they have one.
 */
export const episodeLabel = (
  t: (key: string, values?: Record<string, unknown>) => string,
  media: MediaCategory,
  number: number,
  title?: string | null,
): string => withChapterTitle(t(episodeLabelKey(media), { number }), media, title);

/** `episodeLabel` for page titles and structured data (the `seo.sentence` keys). */
export const seoEpisodeLabel = (
  t: (key: string, values?: Record<string, unknown>) => string,
  media: MediaCategory,
  n: number,
  title?: string | null,
): string => withChapterTitle(t(seoEpisodeLabelKey(media), { n }), media, title);

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
 * Separate HTTP failures from opaque fetch rejections, which expose no status and can represent CORS,
 * network, offline or extension failures.
 */
export type AudioFetchFailureKind = 'http' | 'opaque';

/**
 * Preserve the failing URL and failure kind so expansion reports identify the audio object rather than a bare
 * fetch rejection.
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
 * Probe opaque failures with no-CORS HEAD to test reachability. An opaque response cannot explain the
 * original CORS-mode failure or expose its status. Probe only after failure and never mask the original
 * error.
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
    attributes['audio.opaque_cause'] = 'reachable';
  } catch {
    attributes['audio.opaque_cause'] = signal?.aborted ? 'probe-timeout' : 'unreachable';
  }

  return attributes;
}

/**
 * A media element's non-CORS response can poison Chromium's cache for later CORS fetches. Retry opaque
 * failures with `cache: 'reload'`; changing playback to require CORS would make ordinary audio depend on CDN
 * policy. Widening allowed origins does not repair the cached request-mode mismatch.
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

  // Wait for every fetch to settle before decoding or propagating a failure.
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

  // Raise the download signup offer centrally so every download call site follows the same policy.
  useSignupNudge().nudgeAfterDownload();

  if (isBlobUrl) {
    const a = document.createElement('a');
    a.href = url as string;
    a.download = filename.replace('mp3', 'wav');
    a.click();
    return;
  }

  // Retry past the same media-element cache hazard handled by `fetchAudioSegment`.
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

/** Our audiobooks come from the Japanese Audible store, where an ASIN is the product page. */
export function audibleUrl(asin: string): string {
  return `https://www.audible.co.jp/pd/${encodeURIComponent(asin)}`;
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
export function tmdbUrl(tmdbId: string, airingFormat: AiringFormat): string {
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
  media: { externalIds?: CatalogExternalIds | null; airingFormat?: AiringFormat } | null | undefined,
): string[] {
  const ids = media?.externalIds;
  const urls: string[] = [];
  if (ids?.anilist) urls.push(anilistAnimeUrl(ids.anilist));
  if (ids?.imdb) urls.push(imdbTitleUrl(ids.imdb));
  if (ids?.tmdb && media?.airingFormat) urls.push(tmdbUrl(ids.tmdb, media.airingFormat));
  if (ids?.youtube) urls.push(youtubeChannelUrl(ids.youtube));
  return urls;
}

// Parse into an inert document: corpus text assigned to a live element's innerHTML would fetch and run
// handlers such as `<img onerror>` even though the element is never attached.
const stripHTMLTags = (html: string): string =>
  new DOMParser().parseFromString(html, 'text/html').body.textContent ?? '';

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
    // Report clipboard rejection as well as the toast; sharing analytics fire only after a successful copy.
    handleApiError('media:share-url-copy-failed', error, { toastKey: false });
    const message = $i18n.t('searchpage.main.labels.errorcopiedsharingurl');
    useToastError(message);
  }
}
