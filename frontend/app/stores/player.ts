import { defineStore } from 'pinia';
import type { SearchResult } from '~/types/search';
import { reportError } from '~/utils/reportError';
import { firstNonBlank } from '~/utils/strings';

function isYoutube(result: SearchResult | null): boolean {
  return !!result && result.media.category === 'YOUTUBE' && !!result.segment.externalVideoId;
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
          reportError('player:audio-play-failed', error, {
            'segment.publicId': this.currentResult?.segment.publicId ?? '',
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
      const audio = this.currentAudio;
      if (!audio) return;
      audio.pause();
      audio.onended = null;
      audio.src = '';
      audio.load();
      this.currentAudio = null;
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
      const audioUrl = result.blobAudioUrl ?? result.segment.urls.audioUrl;
      // markRaw: the media element is a DOM handle, not state to make reactive or
      // serialize into the SSR payload.
      const audio = markRaw(new Audio(audioUrl));
      this.currentAudio = audio;

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
      } else if (this.currentAudio) {
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
      } else if (this.currentAudio) {
        this.currentAudio.currentTime = 0;
        this.startAudio(this.currentAudio, false);
        this.isPlaying = true;
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
