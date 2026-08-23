import { ankiStore } from '~/stores/anki';
import { userStore } from '~/stores/auth';
import { minedNoteQuery } from '~/utils/ankiMining';
import type { MinedWord } from '~/utils/ankiWord';
import type { SearchResult } from '~/types/search';
// The singleton, not `usePostHog()`, for the same reason the word card imports
// it this way: that composable resolves through `useNuxtApp()` and throws when
// it is reached from a detached async continuation, which is exactly where the
// probe's answer is reported from -- after `await executeAction`.
import { posthog } from '~/utils/posthogClient';

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
 * @param currentMined  The open card's content, rendered for a note. A getter for
 *                      the same reason as the word above, and read at the moment
 *                      the reader presses the button rather than captured: the
 *                      lookup lands after the card opens, so a value read any
 *                      earlier would be the fallback rather than the dictionary.
 */
export function useWordMining(
  currentResult: () => SearchResult | undefined,
  currentWord: () => string,
  currentMined: () => MinedWord | null = () => null,
) {
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
  const canConfigureMine = computed(() => {
    const configured = profile.value;
    return !!configured && !!configured.deck && !!configured.model && configured.fields.length > 0;
  });

  // The key field is the identity of a sentence-level Anki export. Keep the
  // base configuration separate so the word popup can leave a visibly disabled
  // control that leads straight to the missing setting.
  const canMine = computed(() => canConfigureMine.value && !!profile.value?.key?.trim());

  /**
   * Why the Anki controls cannot act, or null when they can.
   *
   * One value rather than a boolean per condition, because the control needs to
   * SAY which one it is and "disabled" on its own is the least useful thing a
   * button can tell somebody. Ordered by what the reader has to do first: no
   * amount of running Anki helps a profile with no note type, so configuration
   * is reported ahead of reachability.
   *
   * `offline` is deliberately not returned while `connectReachable` is null.
   * Nothing has asked AnkiConnect yet at that point, and announcing "Anki is not
   * running" to a reader whose Anki is running perfectly well -- they simply have
   * not opened a card yet -- is worse than saying nothing.
   */
  const mineBlockedReason = computed<'not-configured' | 'no-key' | 'offline' | null>(() => {
    if (!canConfigureMine.value) return 'not-configured';
    if (!profile.value?.key?.trim()) return 'no-key';
    if (anki.connectReachable === false) return 'offline';
    return null;
  });

  /** Whether the controls should act, as opposed to explain. */
  const mineReady = computed(() => mineBlockedReason.value === null);

  /**
   * Whether this profile has any field a pick could change.
   *
   * Read by the card to decide whether to offer the toggles at all: on a profile
   * that writes no definition anywhere, ticking a dictionary would be a control
   * with no effect. Any of the three counts -- the pick narrows the stack, and
   * all three are derived from it.
   */
  const mapsDefinition = computed(() =>
    (profile.value?.fields ?? []).some((field) => field.value?.includes('{definition')),
  );

  /** The expression field is what "already mined" is judged on, and it is
   *  optional in settings -- so a profile can be perfectly able to export and
   *  still have no way to answer the question. Mining then falls back to the
   *  last added card, exactly as it did before this existed. */
  const canCheckMined = computed(() => canMine.value);

  /**
   * Whether a note this creates could ever be found again.
   *
   * The condition is narrow on purpose: the profile must write the WORD into the
   * very field the probe searches. That is the field `minedNoteQuery` matches
   * on, so a note created without it is invisible to the next probe -- and
   * invisible means the next mine of the same word creates another one, and the
   * reader collects a duplicate per visit without anything ever reporting an
   * error.
   *
   * It is also what keeps this from changing anything for the setup that came
   * first. A Yomitan reader names Expression as their key field and does NOT map
   * it here -- Yomitan already filled it -- so they fail this check and keep the
   * last-added-card behaviour they have always had. Creating for them would be
   * the worst of both: a second, emptier note beside the one Yomitan just made.
   *
   * `{word-furigana}` counts alongside `{word}` because the probe already looks
   * for both spellings (`field:手加減` OR `field:手加減[*`), which is exactly the
   * furigana form.
   */
  const canCreate = computed(() => {
    const configured = profile.value;
    const key = configured?.key?.trim();
    if (!canCheckMined.value || !key) return false;

    const keyField = configured?.fields.find((field) => field.key === key);
    return /\{word(-furigana)?\}/.test(keyField?.value ?? '');
  });

  /**
   * @param report Whether this probe is a reader asking about a word. False for
   *               the one that follows an export -- see `reportProbe`, and
   *               `mineSentence` for why that probe happens at all.
   */
  async function probeMined({ report = true }: { report?: boolean } = {}): Promise<void> {
    const word = currentWord();
    minedNoteId.value = null;

    if (!import.meta.client || !word || !canCheckMined.value || ankiUnreachable) return;

    /** Note ids for this word, `null` when Anki did not answer at all. */
    const ask = async (deck?: string): Promise<number[] | null> => {
      const query = minedNoteQuery({ word, key: profile.value?.key, deck });
      if (!query) return [];
      const response = (await anki.executeAction('findNotes', { query }, { silent: true })) as FindNotesResponse;
      // Null is the transport failing rather than the collection answering
      // "none": Anki is closed, the add-on is off, or CORS refused us.
      return response === null ? null : (response.result ?? []);
    };

    let ids = await ask(profile.value?.deck);

    // The reader has moved to another word, or closed the card, while Anki was
    // answering about this one. Dropping the answer is the whole job of the
    // guard: a card is re-opened on a different word long before a slow probe
    // lands, and this one would otherwise star a word nobody has mined.
    if (currentWord() !== word) return;
    if (ids === null) {
      // Trip the breaker so the rest of the page stops asking.
      ankiUnreachable = true;
      return;
    }

    /**
     * Nothing in the mining deck, so ask the whole collection before concluding
     * the word is new.
     *
     * The two questions have different scopes and that mismatch was a dead end
     * for the reader: this probe is scoped to the deck, while the duplicate
     * check Anki runs at `addNote` is scoped to the NOTE TYPE and ignores decks
     * entirely. A word already mined into some other deck therefore looked new
     * here, offered a "create", and got refused with "cannot create note because
     * it is a duplicate" -- an error with nothing the reader could do about it.
     *
     * Asking again unscoped costs one local round trip on words that turn out to
     * be new, and turns that dead end into the note they already have. The deck
     * still wins when it holds a copy, which is why this is a fallback rather
     * than the only question.
     */
    if (ids.length === 0 && profile.value?.deck) {
      ids = await ask(undefined);
      if (currentWord() !== word) return;
      if (ids === null) {
        ankiUnreachable = true;
        return;
      }
    }
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
    // Unguarded: posthog-js is fetched asynchronously, so a `__loaded` test here
    // would drop the probes on the first card of a page load -- the one a reader
    // is most likely to open. `posthog` queues until the SDK lands and no-ops for
    // good on builds that have none.
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
   * Put this word -- and this sentence for it -- in the reader's collection.
   *
   * Three targets, in order of how much the collection told us:
   *
   *   the note the probe found  the reader has mined this word before, so this
   *                             sentence improves THAT card. A word mined last
   *                             month is found again rather than duplicated.
   *   a new note                the probe asked, the word is not there, and the
   *                             profile writes the word into the field the probe
   *                             reads (`canCreate`). This is what makes the word
   *                             card a miner in its own right rather than a
   *                             companion to Yomitan.
   *   the last added card       everything else. It is the old behaviour, kept
   *                             for the setup it was written for: something else
   *                             made the note a moment ago and this fills in the
   *                             sentence.
   *
   * The middle one is not simply "there was no note id". That is also true when
   * nothing was asked, and when the created note would be unfindable -- and
   * creating in either case hands the reader a duplicate per mine. See
   * `canCreate` for why the condition is as narrow as it is.
   */
  async function mineSentence({ wordFields = true }: { wordFields?: boolean } = {}): Promise<void> {
    const sentence = currentResult();
    const word = currentWord();
    if (!sentence || !word || mining.value || !canMine.value) return;

    // The reader is asking for Anki by name, so give it another chance: the
    // breaker exists to stop pointless probes, not to lock the feature out for
    // the rest of the session once Anki is finally running.
    ankiUnreachable = false;
    mining.value = true;
    const creating = minedNoteId.value === null && canCreate.value;
    try {
      await anki.addResultToAnki(sentence, {
        noteId: minedNoteId.value ?? undefined,
        method:
          minedNoteId.value !== null
            ? wordFields
              ? 'word_card_note'
              : 'word_card_context'
            : creating
              ? 'word_card_create'
              : 'word_card_last',
        word: currentMined() ?? undefined,
        wordFields,
        create: creating,
      });
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
  return {
    minedNoteId,
    mining,
    canConfigureMine,
    canMine,
    mineBlockedReason,
    mineReady,
    mapsDefinition,
    probeMined,
    clearMined,
    openMinedNote,
    mineSentence,
  };
}
