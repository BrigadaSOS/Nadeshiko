import { computed, ref } from 'vue';

/** A word the card can stand on: the token it opened on, or a part walked into
 *  from it. The same shape `peekWord`/`fetchWord` are keyed by. */
export interface CardLocation {
  lemma: string;
  surface: string;
  reading: string;
  pos: string;
}

/**
 * An empty trail resolves to origin(); deepest parts are last. New navigation discards forward
 * history. Share load across parts and history controls so rendering and staleness rules agree.
 */
export function useCardTrail(load: (location: CardLocation) => Promise<void>, origin: () => CardLocation | null) {
  const trail = ref<CardLocation[]>([]);
  const forward = ref<CardLocation[]>([]);
  const canGoBack = computed(() => trail.value.length > 0);
  const canGoForward = computed(() => forward.value.length > 0);

  function currentLocation(): CardLocation | null {
    return trail.value[trail.value.length - 1] ?? origin();
  }

  async function showPart(part: { lemma: string; text: string; reading?: string }): Promise<void> {
    const location = { lemma: part.lemma, surface: part.text, reading: part.reading ?? '', pos: '' };
    trail.value = [...trail.value, location];
    forward.value = [];
    await load(location);
  }

  async function goBack(): Promise<void> {
    const left = trail.value[trail.value.length - 1];
    if (!left) return;
    trail.value = trail.value.slice(0, -1);
    forward.value = [...forward.value, left];
    const target = currentLocation();
    if (target) await load(target);
  }

  async function goForward(): Promise<void> {
    const next = forward.value[forward.value.length - 1];
    if (!next) return;
    forward.value = forward.value.slice(0, -1);
    trail.value = [...trail.value, next];
    await load(next);
  }

  /** Nothing survives the card closing or moving to another word: the trail is
   *  about one card's worth of wandering, not a page-level history. */
  function clearTrail(): void {
    trail.value = [];
    forward.value = [];
  }

  return { canGoBack, canGoForward, currentLocation, showPart, goBack, goForward, clearTrail };
}
