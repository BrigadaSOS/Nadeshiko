import { computed, ref } from 'vue';
import { fetchWord, peekWord, type WordLookup } from '~/utils/wordLookup';
import { lookupState, type ShirabeCandidate } from '~/utils/wordCard';

/** A word the card can ask about. The shape `peekWord`/`fetchWord` key on: two
 *  tokens for the same word in the same shape are interchangeable, two
 *  spellings of it are not. */
export interface LookupRef {
  lemma: string;
  surface: string;
  reading: string;
  pos: string;
}

/** What the card SAYS when it has no senses to print. 'missing' is specifically
 *  "we asked and there is no entry"; a lookup that could not be made stays
 *  'idle', because claiming no entry for a question nobody put would be a lie. */
export type WordState = 'idle' | 'loading' | 'name' | 'missing' | 'unavailable';

/**
 * The card's lookup: which words a token could be, which one is showing, and
 * how the answer got here.
 *
 * Holds the cache read, the request, and the staleness guard that decides
 * whether a late answer is still wanted. `onApplied` fires whenever an answer is
 * painted, which is where the caller re-asks anything that depends on the word
 * (the Anki probe).
 */
export function useWordLookup(glossLabels: () => string, onApplied: () => void) {
  /**
   * Which words this token could be, and which of them the card is showing.
   *
   * A LIST, not a word: Shirabe answers with every word a spelling can name,
   * ranked -- きみ is 君, 黄身 or 黍 -- because one answer is a claim it often
   * cannot support. `candidates[0]` is its best reading of the sentence and where
   * the card opens; `picked` is where the reader moved it.
   */
  const candidates = ref<ShirabeCandidate[]>([]);
  const picked = ref(0);

  /**
   * Shut by default, and reset per card.
   *
   * A reader who opened the list on ここ was asking about ここ. Carrying that open
   * state to the next word they hover would answer a question they have not asked
   * yet, on a card where the alternatives are usually noise.
   */
  const othersOpen = ref(false);

  const wordState = ref<WordState>('idle');

  /**
   * Each reader action gets a new generation. Comparing a generation rather
   * than a word identity matters for the cache path: selecting cached B must
   * revoke an in-flight request for A before A can paint over B.
   */
  let lookupGeneration = 0;

  /** The word the card renders: whichever candidate the reader has picked. */
  const word = computed<ShirabeWord | null>(() => candidates.value[picked.value] ?? null);

  /** Empty the lookup, so nothing from the last word survives into the next one.
   *  `picked` resets with the rest: a reader who chose 黄身 on one token must not
   *  find the next one opening on its second candidate. */
  function clearLookup(): void {
    lookupGeneration++;
    candidates.value = [];
    picked.value = 0;
    othersOpen.value = false;
    wordState.value = 'idle';
  }

  /** Paint an answer, whichever of the four it is. Only a dictionary that
   *  answered "no such word" reaches 'missing' and is said out loud; a lookup that
   *  could not be made leaves the card quiet, on what the token itself knows. */
  function applyLookup(answer: WordLookup): void {
    candidates.value = answer.candidates;
    picked.value = 0;
    othersOpen.value = false;
    // 'shown' becomes 'idle' here: with candidates in hand the card has something
    // to draw and needs no state of its own. The other three are things it says.
    const state = lookupState(answer.candidates.length, answer.reason, answer.nameOnly);
    wordState.value = state === 'shown' ? 'idle' : state;
    onApplied();
  }

  /**
   * Ask for a word, from the cache if the page already has it.
   *
   * Returns the answer and whether it came from the cache, so the caller can
   * report the outcome; returns null when a late answer was discarded, which is
   * not an outcome anybody should record.
   *
   * The cached path is SYNCHRONOUS and paints with no intermediate 'loading', so
   * a word the reader has seen before (or that hovering prefetched a moment ago)
   * opens filled in rather than flashing "Looking up…" for a frame first.
   */
  async function lookUp(ref: LookupRef): Promise<{ answer: WordLookup; fromCache: boolean } | null> {
    const locale = glossLabels();
    lookupGeneration++;

    const cached = peekWord(ref, locale);
    if (cached !== undefined) {
      applyLookup(cached);
      return { answer: cached, fromCache: true };
    }

    clearLookup();
    wordState.value = 'loading';
    const pendingGeneration = lookupGeneration;

    const found = await fetchWord(ref, locale);

    // Nothing clears `wordState` on this path, deliberately: the reader action
    // that superseded this one owns it now.
    if (lookupGeneration !== pendingGeneration) return null;

    applyLookup(found);
    return { answer: found, fromCache: false };
  }

  /** Forget what the card was waiting on. A request abandoned in flight (the
   *  reader closed the card before it answered) would otherwise leave the next
   *  open stuck reading "Looking up…". */
  function cancelPending(): void {
    lookupGeneration++;
  }

  return {
    candidates,
    picked,
    othersOpen,
    wordState,
    word,
    clearLookup,
    applyLookup,
    lookUp,
    cancelPending,
  };
}
