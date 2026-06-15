import { defineStore } from 'pinia';
import type { SearchResult } from '~/types/search';

function isYoutube(result: SearchResult | null): boolean {
  return !!result && result.media.category === 'YOUTUBE' && !!result.segment.externalVideoId;
}

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
            mediaName: this.currentResult?.media.nameRomaji,
            japaneseText: this.currentResult?.segment.textJa.content,
          })
          .catch(() => {});
      }
    },

    playCurrent() {
      if (this.currentAudio) {
        this.currentAudio.pause();
        this.currentAudio.onended = null;
        this.currentAudio.src = '';
        this.currentAudio.load();
        this.currentAudio = null;
      }

      const result = this.currentResult;
      if (!result) return;

      const yt = useYoutubeSegmentPlayer();

      if (isYoutube(result)) {
        const seg = result.segment;
        yt.play(seg.publicId, seg.externalVideoId ?? '', seg.startTimeMs, seg.endTimeMs, () => this.handleEnded());
        this.isPlaying = true;
        this.trackPlay();
        return;
      }

      yt.stop();
      const audioUrl = result.blobAudioUrl ?? result.segment.urls.audioUrl;
      this.currentAudio = new Audio(audioUrl);

      this.currentAudio
        .play()
        .then(() => {
          this.isPlaying = true;
          this.trackPlay();
        })
        .catch((error) => {
          console.error('Error playing audio:', error);
          this.isPlaying = false;
        });

      this.currentAudio.onended = () => this.handleEnded();
    },

    play() {
      if (isYoutube(this.currentResult)) {
        const yt = useYoutubeSegmentPlayer();
        if (yt.activeSegmentId.value === this.currentResult?.segment.publicId) {
          yt.resume();
        } else {
          this.playCurrent();
        }
        this.isPlaying = true;
      } else if (this.currentAudio) {
        this.currentAudio.play();
        this.isPlaying = true;
      } else {
        this.playCurrent();
      }
    },

    pause() {
      if (isYoutube(this.currentResult)) {
        useYoutubeSegmentPlayer().pause();
        this.isPlaying = false;
      } else if (this.currentAudio) {
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
        useYoutubeSegmentPlayer().restart();
        this.isPlaying = true;
      } else if (this.currentAudio) {
        this.currentAudio.currentTime = 0;
        this.currentAudio.play();
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
      if (this.currentAudio) {
        this.currentAudio.pause();
      }
      useYoutubeSegmentPlayer().stop();
      this.showPlayer = false;
      this.playlist = [];
      this.currentIndex = null;
      this.isPlaying = false;
      this.currentAudio = null;
      this.isImmersive = false;
    },
  },
});
