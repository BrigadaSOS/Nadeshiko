import { defineStore } from 'pinia';
import type { SearchResult } from '~/types/search';

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
      this.playCurrent();
    },

    playCurrent() {
      if (this.currentAudio) {
        this.currentAudio.pause();
        this.currentAudio.onended = null;
        this.currentAudio.src = '';
        this.currentAudio.load();
      }

      if (this.currentResult) {
        const audioUrl = this.currentResult.blobAudioUrl ?? this.currentResult.segment.urls.audioUrl;
        this.currentAudio = new Audio(audioUrl);

        this.currentAudio
          .play()
          .then(() => {
            this.isPlaying = true;
            const sdk = useNadeshikoSdk();
            sdk.trackUserActivity({
              body: {
                activityType: 'SEGMENT_PLAY',
                segmentUuid: this.currentResult?.segment.uuid,
                mediaId: this.currentResult?.media.id,
                mediaName: this.currentResult?.media.nameRomaji,
                japaneseText: this.currentResult?.segment.textJa.content,
              },
            }).catch(() => {});
          })
          .catch((error) => {
            console.error('Error playing audio:', error);
            this.isPlaying = false;
          });

        this.currentAudio.onended = () => {
          if (this.repeat) {
            this.playCurrent();
          } else if (this.autoplay) {
            this.next();
          } else {
            this.isPlaying = false;
          }
        };
      }
    },

    play() {
      if (this.currentAudio) {
        this.currentAudio.play();
        this.isPlaying = true;
      } else {
        this.playCurrent();
      }
    },

    pause() {
      if (this.currentAudio) {
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
    },

    toggleRepeat() {
      this.repeat = !this.repeat;
    },

    toggleImmersive() {
      this.isImmersive = !this.isImmersive;
    },

    next() {
      if (this.currentIndex !== null && this.currentIndex < this.playlist.length - 1) {
        this.currentIndex++;
        this.playCurrent();
      } else {
        this.isPlaying = false;
      }
    },

    prev() {
      if (this.currentIndex !== null && this.currentIndex > 0) {
        this.currentIndex--;
        this.playCurrent();
      }
    },

    restart() {
      if (this.currentAudio) {
        this.currentAudio.currentTime = 0;
        this.currentAudio.play();
        this.isPlaying = true;
      }
    },

    hidePlayer() {
      if (this.currentAudio) {
        this.currentAudio.pause();
      }
      this.showPlayer = false;
      this.playlist = [];
      this.currentIndex = null;
      this.isPlaying = false;
      this.currentAudio = null;
      this.isImmersive = false;
    },
  },
});
