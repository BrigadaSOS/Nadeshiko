import { defineStore } from 'pinia';
import type { Sentence } from './search';

interface PlayerState {
  playlist: Sentence[];
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
    currentSentence(state): Sentence | null {
      if (state.currentIndex !== null) {
        const sentence = state.playlist[state.currentIndex];
        if (sentence) {
          return sentence;
        }
      }
      return null;
    },
  },

  actions: {
    setPlaylist(sentences: Sentence[], startIndex: number) {
      this.playlist = sentences;
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

      if (this.currentSentence) {
        const audioUrl = this.currentSentence.mediaInfo.blobAudioUrl ?? this.currentSentence.mediaInfo.pathAudio;
        this.currentAudio = new Audio(audioUrl);

        this.currentAudio
          .play()
          .then(() => {
            this.isPlaying = true;
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
