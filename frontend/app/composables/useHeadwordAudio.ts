import { ref, onBeforeUnmount } from 'vue';

/**
 * The word card's pronunciation clips.
 *
 * One `Audio` element per card, reused across every accent and every word the
 * card opens on, because clips are under a second and a fresh element per click
 * leaks one per lookup.
 */
export function useHeadwordAudio() {
  /** The clip playing right now, by URL, so that only the button that started it
   *  lights up. A word read two ways has a button per accent, and a plain boolean
   *  lit both of them over a recording of one. */
  const playingUrl = ref('');
  let headAudio: HTMLAudioElement | null = null;

  /** Stop whatever is playing and forget it was. The clip belongs to the word on
   *  the card, so it must not outlive it: leaving it to finish would light up the
   *  play button on the NEXT word the reader opens, over a recording of the last
   *  one. */
  const stopHeadword = () => {
    headAudio?.pause();
    playingUrl.value = '';
  };

  const playHeadword = (src: string) => {
    if (!src) return;

    // Assigning `src` on an element that is already playing replaces the clip,
    // which is what re-clicking should do anyway.
    if (!headAudio) {
      headAudio = new Audio();
      headAudio.addEventListener('ended', () => {
        playingUrl.value = '';
      });
      headAudio.addEventListener('error', () => {
        playingUrl.value = '';
      });
    }

    if (headAudio.src !== src) headAudio.src = src;
    headAudio.currentTime = 0;
    playingUrl.value = src;
    // A clip the CDN has lost, or a browser that declines to play, must not leave
    // the button stuck mid-play. Only if this clip is still the one playing,
    // though: switching accents mid-clip rejects the FIRST play() with an abort,
    // and clearing on that would darken the button of the clip that just started.
    headAudio.play().catch(() => {
      if (playingUrl.value === src) playingUrl.value = '';
    });
  };

  onBeforeUnmount(() => {
    stopHeadword();
    headAudio = null;
  });

  return { playingUrl, playHeadword, stopHeadword };
}
