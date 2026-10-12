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
 * Probe and mine through the reader's local AnkiConnect. Keep state per open card rather than
 * caching results that other mining tools can immediately invalidate.
 */

/**
 * One failed background probe suppresses further probes for this page load. An explicit mine
 * resets the breaker so starting Anki mid-session works.
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
   * Report configuration problems before reachability. Untested connectReachable=null must not
   * be called offline.
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
   * Creation requires {word} or {word-furigana} in the key field searched by the probe;
   * otherwise the new note cannot be found and later mines duplicate it. Yomitan-managed key
   * fields retain last-card behavior. The probe accepts both plain and furigana spellings.
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
     * If the deck has no match, probe the whole collection: Anki's duplicate check is
     * note-type-scoped, not deck-scoped. Prefer the deck's copy when present.
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
   * Count only probes Anki actually answered. Unasked or unreachable cases would corrupt the
   * mined-rate denominator; breaker failures also count pages rather than words. lemma joins
   * the event to word_card_opened.
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
   * Target the probed note; otherwise create only when canCreate permits a findable note after
   * a negative probe. All other cases retain last-added-card behavior.
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
    // Re-probe only if the card still shows this word: export does not return an outcome and
    // may target another word's last-added note. Do not count this bookkeeping probe, which
    // would inflate the mined rate.
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
