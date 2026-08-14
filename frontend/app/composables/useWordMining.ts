import { ankiStore } from '~/stores/anki';
import { userStore } from '~/stores/auth';
import { minedNoteQuery } from '~/utils/ankiMining';
import type { SearchResult } from '~/types/search';
// The singleton, not `usePostHog()`, for the same reason the word card imports
// it this way: that composable resolves through `useNuxtApp()` and throws when
// it is reached from a detached async continuation, which is exactly where the
// probe's answer is reported from -- after `await executeAction`.
import posthog from 'posthog-js';

/**
 * The word card's half of the Anki workflow: whether the open word is already
 * in the reader's collection, and sending this sentence to it.
 *
 * All of it runs against AnkiConnect on the reader's own machine, so there is
 * nothing to ask our API about and nothing that works without Anki running.
 * That is also why the state lives per open card rather than in a cache: a
 * localhost request costs a fraction of a millisecond and a collection changes
 * under us constantly -- the reader mines a word in Yomitan and comes straight
 * back to the same page -- so a remembered "not mined" would be wrong within
 * seconds and would be wrong in the direction that hides the button that
 * matters.
 */

/**
 * Whether AnkiConnect has already refused to answer this page load.
 *
 * Module scope, so one refusal covers every sentence on the page rather than
 * each of them finding out separately. Anki closed is the ordinary state for a
 * reader who is only reading, and the probe fires on every card they open;
 * without this it is a doomed connection attempt per word, forever.
 *
 * Cleared whenever the reader actually asks to mine something, because by then
 * they have plainly gone and started Anki -- a breaker that never resets would
 * mean starting Anki mid-session does nothing until a reload.
 */
let ankiUnreachable = false;

type FindNotesResponse = { result?: number[] } | null;

/**
 * @param currentResult The segment the open card belongs to -- what a mine sends.
 * @param currentWord   The word the card is open on, empty when it is closed.
 *                      A getter rather than a captured string because it is also
 *                      the staleness guard: everything here is asked about
 *                      whatever is open NOW and discarded if that has changed by
 *                      the time Anki answers.
 */
export function useWordMining(currentResult: () => SearchResult | undefined, currentWord: () => string) {
  const anki = ankiStore();
  const user = userStore();

  /** The note the open word is already mined into, the most recent one if there
   *  are several. Null means "asked, and there is none" or "not asked". */
  const minedNoteId = ref<number | null>(null);
  const mining = ref(false);

  // Profiles live in user preferences, so a signed-out reader has none and every
  // control below stays hidden -- which is the same gate the segment's own Anki
  // actions use, arrived at without a second condition.
  const profile = computed(() => (user.isLoggedIn ? anki.activeProfile : null));

  /** Enough configuration to fill a note: which deck and note type to look in,
   *  and at least one field mapping to write. The same four things
   *  `SegmentActionsContainer` checks before enabling its own Anki items. */
  const canMine = computed(() => {
    const configured = profile.value;
    return !!configured && !!configured.deck && !!configured.model && configured.fields.length > 0;
  });

  /** The expression field is what "already mined" is judged on, and it is
   *  optional in settings -- so a profile can be perfectly able to export and
   *  still have no way to answer the question. Mining then falls back to the
   *  last added card, exactly as it did before this existed. */
  const canCheckMined = computed(() => canMine.value && !!profile.value?.key?.trim());

  /**
   * @param report Whether this probe is a reader asking about a word. False for
   *               the one that follows an export -- see `reportProbe`, and
   *               `mineSentence` for why that probe happens at all.
   */
  async function probeMined({ report = true }: { report?: boolean } = {}): Promise<void> {
    const word = currentWord();
    minedNoteId.value = null;

    if (!import.meta.client || !word || !canCheckMined.value || ankiUnreachable) return;

    const query = minedNoteQuery({ word, key: profile.value?.key, deck: profile.value?.deck });
    if (!query) return;

    const response = (await anki.executeAction('findNotes', { query }, { silent: true })) as FindNotesResponse;

    // The reader has moved to another word, or closed the card, while Anki was
    // answering about this one. Dropping the answer is the whole job of the
    // guard: a card is re-opened on a different word long before a slow probe
    // lands, and this one would otherwise star a word nobody has mined.
    if (currentWord() !== word) return;

    // Null is the transport failing rather than the collection answering
    // "none": Anki is closed, the add-on is off, or CORS refused us. Trip the
    // breaker so the rest of the page stops asking.
    if (response === null) {
      ankiUnreachable = true;
      return;
    }

    const ids = response.result ?? [];
    // The newest, when a word has been mined more than once. Note ids are
    // creation timestamps, so the largest is the most recent -- and a reader
    // with a duplicate wants the card they just made, not the one from a year
    // ago. Same reduction the last-added-card export uses.
    minedNoteId.value = ids.length > 0 ? Math.max(...ids) : null;

    if (report) reportProbe(word, minedNoteId.value !== null);
  }

  /**
   * What the reader's own collection said about a word they looked up.
   *
   * The question this exists to answer is how much of what readers stop to look
   * up they have already mined -- which is the difference between a card that
   * mostly tells them something new and one that mostly tells them they own this
   * already, and it is not something any server-side metric can see: the answer
   * lives on their machine.
   *
   * Reported ONLY where Anki actually answered, which is the whole discipline of
   * this event. The three cases that never asked -- no profile, no expression
   * field configured, Anki unreachable -- are not the collection saying "no",
   * and folding them in would put a denominator of "every card opened by
   * everyone" under a numerator of "words mined by readers who run Anki". The
   * unreachable case is left out for a second reason on top of that: the breaker
   * means it can only fire once per page load, so it counts pages while the
   * other two count words, and a share computed across the three would be
   * meaningless in a way nothing on the chart would show.
   *
   * `lemma` matches the field `word_card_opened` sends, so the two can be joined
   * on the word: which words readers look up and already own, versus which they
   * look up again and again and have never mined.
   */
  function reportProbe(word: string, mined: boolean): void {
    if (!posthog.__loaded) return;
    posthog.capture('word_card_mined_checked', { mined, lemma: word });
  }

  /** Forget what the closed card knew, so the next one never opens wearing the
   *  previous word's star. Any probe still in flight cancels itself, because
   *  `currentWord` no longer answers what it was asked about. */
  function clearMined(): void {
    minedNoteId.value = null;
  }

  /** Bring Anki's browser forward on the note this word is already in. */
  async function openMinedNote(): Promise<void> {
    const noteId = minedNoteId.value;
    if (noteId === null) return;
    ankiUnreachable = false;
    await anki.guiBrowse(`nid:${noteId}`);
  }

  /**
   * Put this sentence -- its text, its audio, its still -- on the reader's card
   * for this word.
   *
   * The note it lands on is the one the probe found, and only the last added
   * card when there is none. That is the difference between this and the
   * dropdown's export: from a word card the target is unambiguous, so a reader
   * revisiting a word they mined last month improves THAT card instead of
   * overwriting whatever they happened to add most recently.
   */
  async function mineSentence(): Promise<void> {
    const sentence = currentResult();
    const word = currentWord();
    if (!sentence || !word || mining.value || !canMine.value) return;

    // The reader is asking for Anki by name, so give it another chance: the
    // breaker exists to stop pointless probes, not to lock the feature out for
    // the rest of the session once Anki is finally running.
    ankiUnreachable = false;
    mining.value = true;
    try {
      await anki.addResultToAnki(
        sentence,
        minedNoteId.value ?? undefined,
        minedNoteId.value === null ? 'word_card_last' : 'word_card_note',
      );
    } finally {
      mining.value = false;
    }
    // Ask again rather than assume. The export reports its own outcome and does
    // not return one, and the last-added path in particular may have written to
    // a note for an entirely different word -- so the star has to be earned by
    // the collection saying so, not by the click having happened.
    //
    // Only while the card is still on the word that was mined. An export takes
    // seconds (it uploads the audio and the still, and may raise Anki's browser
    // twice), which is long enough for the reader to have closed the card or
    // opened another word -- and re-probing then would blank the new card's star
    // and answer it with the previous word's collection.
    // Unreported: this one is bookkeeping, not a reader asking a question, and
    // it runs at the one moment the answer is almost guaranteed to be "mined" --
    // we have just written to a note. Counting it would inflate the mined rate
    // by exactly the number of times readers used the button, which is the one
    // number the event must not be sensitive to.
    if (currentWord() === word) await probeMined({ report: false });
  }

  // `canCheckMined` stays internal: it decides whether a probe is worth making,
  // and a caller has nothing to do with the answer -- the star's absence already
  // says "not mined, or we could not ask", which is the only thing the card can
  // honestly claim either way.
  return { minedNoteId, mining, canMine, probeMined, clearMined, openMinedNote, mineSentence };
}
