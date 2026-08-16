import { defineStore } from 'pinia';
import type { SearchResult } from '~/types/search';
import { reportError } from '~/utils/reportError';
import { firstNonBlank } from '~/utils/strings';

function isYoutube(result: SearchResult | null): boolean {
  return !!result && result.media.category === 'YOUTUBE' && !!result.segment.externalVideoId;
}

/**
 * The audio a result should play right now: its expansion blob when one has been
 * built, the original object otherwise.
 *
 * Read on every play rather than once per track. Expanding a segment swaps the
 * blob in (and reverting swaps it back out) long after the element was built, and
 * a paused player resuming its old element is how "the audio doesn't get replaced"
 * survived even when the expansion itself had worked.
 */
export function resolveAudioSource(result: SearchResult): string {
  return result.blobAudioUrl ?? result.segment.urls.audioUrl;
}

/**
 * Rejections of `HTMLAudioElement.play()` that describe the reader rather than a
 * fault, and so are dropped instead of reported.
 *
 * - `AbortError`: the user agent abandoned the load "at the user's request" --
 *   navigating away, closing the tab, stopping playback mid-load.
 * - `NotAllowedError`: the autoplay policy. This play() was not close enough to
 *   a gesture for the reader's settings; they press play again and it works.
 *
 * Filtered here rather than tolerated in PostHog, because an issue nobody acts
 * on is worse than no issue: its status and last-seen stop describing anything,
 * and the `NotSupportedError` cases underneath -- a clip that genuinely will not
 * decode, which IS worth knowing about -- get read as more of the same. Between
 * them these two were 234 of the 255 reports on this fingerprint over a week,
 * out of 9 sessions; the 21 that matter came from 14. The same confusion
 * `$exception_fingerprint` was added to `reportError` to end.
 */
export function isUnactionablePlaybackError(error: unknown): boolean {
  // Matched on `name` against any Error rather than on `instanceof DOMException`:
  // the name is the part the spec pins down, and narrowing to the class buys
  // nothing here -- nothing else rejects a play() with either of these names.
  return error instanceof Error && (error.name === 'AbortError' || error.name === 'NotAllowedError');
}

/**
 * Identifies the most recent playback intent. `HTMLAudioElement.play()` settles
 * asynchronously, so a promise from a track the user already skipped past would
 * otherwise flip `isPlaying` and fire analytics for whatever is playing *now* —
 * and its expected AbortError would report as a failure. Every action that
 * supersedes playback (new track, pause, hide) takes a fresh token; stale
 * settlements compare unequal and do nothing.
 *
 * Module scope is safe: audio only ever exists on the client.
 */
let playbackToken = 0;

interface PlayerState {
  playlist: SearchResult[];
  currentIndex: number | null;
  isPlaying: boolean;
  showPlayer: boolean;
  currentAudio: HTMLAudioElement | null;
  /** The url `currentAudio` was built from, so a stale element can be spotted. */
  currentSource: string | null;
  autoplay: boolean;
  repeat: boolean;
  isImmersive: boolean;
}

export const usePlayerStore = defineStore('player', {
  state: (): PlayerState => ({
    playlist: [],
    currentIndex: null,
    isPlaying: false,
    showPlayer: false,
    currentAudio: null,
    currentSource: null,
    autoplay: false,
    repeat: false,
    isImmersive: false,
  }),

  getters: {
    currentResult(state): SearchResult | null {
      if (state.currentIndex !== null) {
        const result = state.playlist[state.currentIndex];
        if (result) {
          return result;
        }
      }
      return null;
    },

    /**
     * Whether the built element no longer matches what the current result should
     * play. Resuming it would replay the pre-expansion clip -- the reader expands
     * a segment, presses play, and hears the sentence they already had.
     */
    isCurrentAudioStale(): boolean {
      const result = this.currentResult;
      if (!result || !this.currentAudio) return false;
      return this.currentSource !== resolveAudioSource(result);
    },
  },

  actions: {
    setPlaylist(results: SearchResult[], startIndex: number) {
      this.playlist = results;
      this.currentIndex = startIndex;
      this.showPlayer = true;
      this.isImmersive = false;

      const result = results[startIndex];
      if (result && import.meta.client) {
        const posthog = usePostHog();
        posthog?.capture('search_result_clicked', {
          media_id: result.media.publicId,
          media_name: result.media.nameRomaji,
          result_position: startIndex,
        });
      }

      this.playCurrent();
    },

    handleEnded() {
      if (this.repeat) {
        this.playCurrent();
      } else if (this.autoplay) {
        this.next();
      } else {
        this.isPlaying = false;
      }
    },

    trackPlay() {
      const posthog = usePostHog();
      posthog?.capture('segment_played', {
        media_id: this.currentResult?.media.publicId,
        media_name: this.currentResult?.media.nameRomaji,
        segment_id: this.currentResult?.segment.publicId,
        playlist_position: this.currentIndex,
        is_autoplay: this.autoplay,
      });

      const user = userStore();
      if (user.isLoggedIn) {
        const sdk = useNadeshikoSdk();
        sdk
          .trackUserActivity({
            activityType: 'SEGMENT_PLAY',
            segmentPublicId: this.currentResult?.segment.publicId,
            mediaPublicId: this.currentResult?.media.publicId,
            // Not `media.nameRomaji` on its own: rows without a romaji title sent
            // `''`, which the API stored and later refused to serialize back.
            // Locale-independent order -- a store action has no `useI18n` context,
            // and this name is stored metadata rather than something rendered now.
            mediaName: firstNonBlank(
              this.currentResult?.media.nameRomaji,
              this.currentResult?.media.nameEn,
              this.currentResult?.media.nameJa,
            ),
            japaneseText: this.currentResult?.segment.textJa.content,
          })
          // Fire-and-forget telemetry: never let it interrupt or warn about audio
          // that is already playing.
          .catch((error: unknown) => reportError('player:track-play-activity-failed', error));
      }
    },

    /**
     * Start `audio` under a fresh playback token. Resolves/rejects that arrive
     * after a newer playback took over are discarded.
     */
    startAudio(audio: HTMLAudioElement, track: boolean) {
      const token = ++playbackToken;

      audio
        .play()
        .then(() => {
          if (token !== playbackToken) return;
          this.isPlaying = true;
          if (track) this.trackPlay();
        })
        .catch((error) => {
          if (token !== playbackToken) return;
          this.isPlaying = false;

          // Note this is not the teardown case: `releaseIfSource`, `hidePlayer`
          // and every `playCurrent` branch bump `playbackToken` before releasing,
          // so a play() we cancelled ourselves is already discarded by the guard
          // above and never reaches here.
          if (isUnactionablePlaybackError(error)) return;

          // What survives is a clip that genuinely would not decode. The source
          // goes on the report because the segment id alone does not say which
          // url was tried: an expansion plays a blob built in the browser, and
          // it fails for reasons a CDN object never would.
          reportError('player:audio-play-failed', error, {
            'segment.publicId': this.currentResult?.segment.publicId ?? '',
            'audio.source': audio.src,
          });
        });
    },

    /**
     * Detach the current media element: stop the download, drop the `onended`
     * closure holding this store, and let it be collected. Blob URLs are *not*
     * revoked here — they belong to `useSegmentConcatenation`, which still needs
     * them for the download/revert actions.
     */
    releaseAudio() {
      this.currentSource = null;
      const audio = this.currentAudio;
      if (!audio) return;
      audio.pause();
      audio.onended = null;
      audio.src = '';
      audio.load();
      this.currentAudio = null;
    },

    /**
     * Release the element if it is playing `source`, so the caller can revoke it.
     *
     * `useSegmentConcatenation` revokes an expansion's blob URL when the reader
     * reverts or expands again. Revoking one the player still holds leaves the
     * element pointed at an address that no longer resolves, which fails the next
     * seek or replay with no error the reader can act on.
     */
    releaseIfSource(source: string) {
      if (this.currentSource !== source) return;
      playbackToken++;
      this.releaseAudio();
      this.isPlaying = false;
    },

    playCurrent() {
      this.releaseAudio();

      const result = this.currentResult;
      if (!result) {
        playbackToken++;
        return;
      }

      const yt = useYoutubeSegmentPlayer();

      if (isYoutube(result)) {
        playbackToken++;
        const seg = result.segment;
        yt.play(seg.publicId, seg.externalVideoId ?? '', seg.startTimeMs, seg.endTimeMs, () => this.handleEnded());
        this.isPlaying = true;
        this.trackPlay();
        return;
      }

      yt.stop();
      const audioUrl = resolveAudioSource(result);
      // markRaw: the media element is a DOM handle, not state to make reactive or
      // serialize into the SSR payload.
      const audio = markRaw(new Audio(audioUrl));
      this.currentAudio = audio;
      // Remembered so a later play can tell this element apart from what the
      // result should be playing by then -- see `isCurrentAudioStale`.
      this.currentSource = audioUrl;
      // NOT `crossOrigin = 'anonymous'`, tempting as it looks. It would make this
      // a CORS request whose cached response `concatenateAudios` could reuse,
      // removing the re-download `fetchAudioSegment` costs -- and since the CDN
      // now answers `Access-Control-Allow-Origin: *` (brigadasos-infra,
      // cloudflare-r2.tf, 2026-08-13) it would no longer break non-production
      // origins the way it once would have.
      //
      // It stays off anyway, because of what it couples together: with it set,
      // whether ANY audio plays at all depends on that policy staying permissive,
      // and a future "let's tighten CORS" would take playback down site-wide
      // rather than degrade one feature. The retry costs ~17KB on an expansion
      // that follows a play, and fails in a way that is confined to expansion.

      this.startAudio(audio, true);

      audio.onended = () => this.handleEnded();
    },

    play() {
      if (isYoutube(this.currentResult)) {
        const yt = useYoutubeSegmentPlayer();
        if (yt.activeSegmentId.value === this.currentResult?.segment.publicId) {
          playbackToken++;
          yt.resume();
        } else {
          this.playCurrent();
        }
        this.isPlaying = true;
      } else if (this.currentAudio && !this.isCurrentAudioStale) {
        this.startAudio(this.currentAudio, false);
        this.isPlaying = true;
      } else {
        this.playCurrent();
      }
    },

    pause() {
      if (isYoutube(this.currentResult)) {
        playbackToken++;
        useYoutubeSegmentPlayer().pause();
        this.isPlaying = false;
      } else if (this.currentAudio) {
        playbackToken++;
        this.currentAudio.pause();
        this.isPlaying = false;
      }
    },

    togglePlay() {
      if (this.isPlaying) {
        this.pause();
      } else {
        this.play();
      }
    },

    toggleAutoplay() {
      this.autoplay = !this.autoplay;
      const posthog = usePostHog();
      posthog?.capture('autoplay_toggled', { enabled: this.autoplay });
    },

    toggleRepeat() {
      this.repeat = !this.repeat;
    },

    toggleImmersive() {
      this.isImmersive = !this.isImmersive;
      const posthog = usePostHog();
      posthog?.capture('immersive_mode_toggled', { enabled: this.isImmersive });
    },

    next() {
      if (this.currentIndex !== null && this.currentIndex < this.playlist.length - 1) {
        this.currentIndex++;
        this.playCurrent();
        const posthog = usePostHog();
        posthog?.capture('segment_navigated', {
          direction: 'next',
          playlist_position: this.currentIndex,
          playlist_size: this.playlist.length,
        });
      } else {
        this.isPlaying = false;
      }
    },

    prev() {
      if (this.currentIndex !== null && this.currentIndex > 0) {
        this.currentIndex--;
        this.playCurrent();
        const posthog = usePostHog();
        posthog?.capture('segment_navigated', {
          direction: 'prev',
          playlist_position: this.currentIndex,
          playlist_size: this.playlist.length,
        });
      }
    },

    restart() {
      if (isYoutube(this.currentResult)) {
        playbackToken++;
        useYoutubeSegmentPlayer().restart();
        this.isPlaying = true;
      } else if (this.currentAudio && !this.isCurrentAudioStale) {
        this.currentAudio.currentTime = 0;
        this.startAudio(this.currentAudio, false);
        this.isPlaying = true;
      } else if (this.currentResult) {
        this.playCurrent();
      } else {
        return;
      }
      const posthog = usePostHog();
      posthog?.capture('segment_replayed', {
        media_id: this.currentResult?.media.publicId,
        segment_id: this.currentResult?.segment.publicId,
      });
    },

    hidePlayer() {
      playbackToken++;
      this.releaseAudio();
      useYoutubeSegmentPlayer().stop();
      this.showPlayer = false;
      this.playlist = [];
      this.currentIndex = null;
      this.isPlaying = false;
      this.isImmersive = false;
    },
  },
});
