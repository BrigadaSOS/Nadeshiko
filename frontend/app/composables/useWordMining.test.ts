import { describe, test, expect, beforeEach, vi } from 'vitest';
import { reactive } from 'vue';

/**
 * Mining a word from the word card into Anki.
 *
 * Four decisions here are narrow on purpose, and each one is narrow because the
 * wide version hands the reader duplicate cards or a dead-end error:
 *
 * `canCreate` REQUIRES THE PROFILE TO WRITE THE WORD INTO THE FIELD THE PROBE
 * SEARCHES. A note created without it is invisible to the next probe, and
 * invisible means the next mine of the same word creates another one -- a
 * duplicate per visit with nothing ever reporting an error. It is also what
 * keeps the Yomitan setup working exactly as before.
 *
 * THE PROBE FALLS BACK TO THE WHOLE COLLECTION. Anki's own duplicate check at
 * `addNote` is scoped to the note TYPE and ignores decks, while this probe is
 * scoped to the deck -- so a word mined into another deck looked new, offered a
 * create, and got refused with an error the reader could do nothing about.
 *
 * A SLOW PROBE THAT LANDS ON ANOTHER WORD IS DROPPED. A card is re-opened on a
 * different word long before a slow probe returns, and it would otherwise star a
 * word nobody has mined.
 *
 * THE MINED-CHECK EVENT IS ONLY SENT WHERE ANKI ACTUALLY ANSWERED. Folding in
 * the cases that never asked would put a denominator of "every card opened by
 * everyone" under a numerator of "words mined by readers who run Anki".
 */
const anki = reactive({
  activeProfile: null as Record<string, unknown> | null,
  connectReachable: null as boolean | null,
  executeAction: vi.fn(),
  addResultToAnki: vi.fn(),
  guiBrowse: vi.fn(),
});
const user = reactive({ isLoggedIn: true });
const posthog = { capture: vi.fn() };

// All three are IMPORTED by name, so a global stub would not be seen. `posthog`
// in particular is the singleton rather than `usePostHog()`, because it queues
// until the SDK lands -- a `__loaded` test would drop the probes on the first
// card of a page load, the one a reader is most likely to open.
vi.mock('~/stores/anki', () => ({ ankiStore: () => anki }));
vi.mock('~/stores/auth', () => ({ userStore: () => user }));
vi.mock('~/utils/posthogClient', () => ({ posthog, onPostHogReady: (fn: (c: unknown) => void) => fn(posthog) }));

/** Re-imports, because an "Anki is unreachable" breaker lives at module scope. */
async function loadComposable() {
  vi.resetModules();
  return (await import('./useWordMining')).useWordMining;
}

/** A profile that can mine: a deck, a note type, a key field, and a mapping. */
function profile(overrides: Record<string, unknown> = {}) {
  return {
    deck: 'Mining',
    model: 'Lapis',
    key: 'Expression',
    fields: [{ key: 'Expression', value: '{word}' }],
    ...overrides,
  };
}

const sentence = { media: { publicId: 'media-1' }, segment: { publicId: 'seg-1' } } as never;

/** The composable, pointed at one word on one sentence. */
async function mining(word = '手加減', mined: Record<string, unknown> | null = null) {
  const useWordMining = await loadComposable();
  const current = { word };
  const api = useWordMining(
    () => sentence,
    () => current.word,
    () => mined as never,
  );
  return { ...api, moveTo: (next: string) => (current.word = next) };
}

/** An AnkiConnect `findNotes` answer. */
const found = (ids: number[]) => ({ result: ids });

beforeEach(() => {
  vi.clearAllMocks();
  user.isLoggedIn = true;
  anki.activeProfile = profile();
  anki.connectReachable = null;
  anki.executeAction.mockResolvedValue(found([]));
  anki.addResultToAnki.mockResolvedValue(undefined);
  anki.guiBrowse.mockResolvedValue([]);
});

describe('whether the controls can act', () => {
  test('a fully configured profile can mine', async () => {
    const m = await mining();

    expect(m.canMine.value).toBe(true);
    expect(m.mineBlockedReason.value).toBeNull();
    expect(m.mineReady.value).toBe(true);
  });

  test('a signed-out reader has no profile, so every control stays hidden', async () => {
    // The same gate the segment's own Anki actions use, arrived at without a
    // second condition.
    user.isLoggedIn = false;

    expect((await mining()).canMine.value).toBe(false);
  });

  test.each([
    ['no deck', { deck: undefined }],
    ['no note type', { model: undefined }],
    ['no field mappings', { fields: [] }],
  ])('%s reads as not-configured', async (_name, patch) => {
    anki.activeProfile = profile(patch);

    expect((await mining()).mineBlockedReason.value).toBe('not-configured');
  });

  test('a missing key field is reported separately from configuration', async () => {
    // So the popup can leave a visibly disabled control that leads straight to
    // the one missing setting.
    anki.activeProfile = profile({ key: '   ' });

    expect((await mining()).mineBlockedReason.value).toBe('no-key');
  });

  test('a configuration problem is reported AHEAD of Anki being closed', async () => {
    // No amount of running Anki helps a profile with no note type.
    anki.activeProfile = profile({ model: undefined });
    anki.connectReachable = false;

    expect((await mining()).mineBlockedReason.value).toBe('not-configured');
  });

  test('says Anki is offline once something has actually asked it', async () => {
    anki.connectReachable = false;

    expect((await mining()).mineBlockedReason.value).toBe('offline');
  });

  test('says NOTHING about Anki before anything has asked', async () => {
    // Announcing "Anki is not running" to a reader whose Anki is running
    // perfectly well -- they simply have not opened a card yet -- is worse than
    // saying nothing.
    anki.connectReachable = null;

    expect((await mining()).mineBlockedReason.value).toBeNull();
  });
});

describe('whether the dictionary toggles are worth offering', () => {
  test.each(['{definition}', '{definition-first}', '{definition:jmdict}'])(
    'a profile writing %s can be narrowed by a pick',
    async (mapping) => {
      anki.activeProfile = profile({ fields: [{ key: 'Back', value: mapping }] });

      expect((await mining()).mapsDefinition.value).toBe(true);
    },
  );

  test('a profile that writes no definition anywhere is not offered them', async () => {
    // Ticking a dictionary would be a control with no effect.
    anki.activeProfile = profile({ fields: [{ key: 'Expression', value: '{word}' }] });

    expect((await mining()).mapsDefinition.value).toBe(false);
  });
});

describe('probing the collection', () => {
  test('stars a word the reader has already mined', async () => {
    anki.executeAction.mockResolvedValue(found([42]));
    const m = await mining();

    await m.probeMined();

    expect(m.minedNoteId.value).toBe(42);
  });

  test('takes the NEWEST note when a word was mined more than once', async () => {
    // Note ids are creation timestamps, and a reader with a duplicate wants the
    // card they just made, not the one from a year ago.
    anki.executeAction.mockResolvedValue(found([10, 900, 55]));
    const m = await mining();

    await m.probeMined();

    expect(m.minedNoteId.value).toBe(900);
  });

  test('asks the WHOLE collection when the mining deck has nothing', async () => {
    // Anki's own duplicate check ignores decks, so a word mined elsewhere looked
    // new here, offered a create, and got refused with a dead-end error.
    anki.executeAction.mockResolvedValueOnce(found([])).mockResolvedValueOnce(found([77]));
    const m = await mining();

    await m.probeMined();

    expect(anki.executeAction).toHaveBeenCalledTimes(2);
    expect(m.minedNoteId.value).toBe(77);
  });

  test('does not ask twice when the deck already answered', async () => {
    // The deck still wins when it holds a copy; the unscoped ask is a fallback.
    anki.executeAction.mockResolvedValue(found([42]));
    const m = await mining();

    await m.probeMined();

    expect(anki.executeAction).toHaveBeenCalledTimes(1);
  });

  test('leaves the word unstarred when the collection has never seen it', async () => {
    const m = await mining();

    await m.probeMined();

    expect(m.minedNoteId.value).toBeNull();
  });

  test('DROPS an answer that arrives after the card moved to another word', async () => {
    // A card is re-opened on a different word long before a slow probe lands,
    // and this would otherwise star a word nobody has mined.
    let release: (value: unknown) => void = () => {};
    anki.executeAction.mockReturnValue(new Promise((resolve) => (release = resolve)));
    const m = await mining('手加減');

    const pending = m.probeMined();
    m.moveTo('別の言葉');
    release(found([42]));
    await pending;

    expect(m.minedNoteId.value).toBeNull();
  });

  test('does not probe at all without a key field to search on', async () => {
    // A profile can be perfectly able to export and still have no way to answer
    // the question; mining then falls back to the last added card.
    anki.activeProfile = profile({ key: undefined });
    const m = await mining();

    await m.probeMined();

    expect(anki.executeAction).not.toHaveBeenCalled();
  });

  test('probes silently, so a closed Anki is not filed once per word looked up', async () => {
    await (await mining()).probeMined();

    expect(anki.executeAction.mock.calls[0]![2]).toMatchObject({ silent: true });
  });

  test('stops asking for the rest of the page once Anki does not answer', async () => {
    // The breaker: Anki being closed is the ordinary state, and asking on every
    // card would be a doomed round trip per word.
    anki.executeAction.mockResolvedValue(null);
    const m = await mining();

    await m.probeMined();
    await m.probeMined();

    expect(anki.executeAction).toHaveBeenCalledTimes(1);
  });

  test('clears the star, so a re-opened card never wears the previous word’s', async () => {
    anki.executeAction.mockResolvedValue(found([42]));
    const m = await mining();
    await m.probeMined();

    m.clearMined();

    expect(m.minedNoteId.value).toBeNull();
  });
});

describe('what the probe reports', () => {
  test('reports that a looked-up word was already mined', async () => {
    // The question: how much of what readers stop to look up they already own.
    anki.executeAction.mockResolvedValue(found([42]));

    await (await mining('手加減')).probeMined();

    expect(posthog.capture).toHaveBeenCalledWith('word_card_mined_checked', { mined: true, lemma: '手加減' });
  });

  test('reports that it was not', async () => {
    await (await mining('手加減')).probeMined();

    expect(posthog.capture).toHaveBeenCalledWith('word_card_mined_checked', { mined: false, lemma: '手加減' });
  });

  test('reports NOTHING when there was no profile to ask with', async () => {
    // Not the collection saying "no". Folding it in would put a denominator of
    // "every card opened by everyone" under a numerator of "words mined by
    // readers who run Anki".
    user.isLoggedIn = false;

    await (await mining()).probeMined();

    expect(posthog.capture).not.toHaveBeenCalled();
  });

  test('reports nothing when there was no key field to search on', async () => {
    anki.activeProfile = profile({ key: undefined });

    await (await mining()).probeMined();

    expect(posthog.capture).not.toHaveBeenCalled();
  });

  test('reports nothing when Anki did not answer', async () => {
    // Left out for a second reason on top: the breaker means it can only fire
    // once per page load, so it would count pages while the others count words.
    anki.executeAction.mockResolvedValue(null);

    await (await mining()).probeMined();

    expect(posthog.capture).not.toHaveBeenCalled();
  });
});

describe('whether a new note could ever be found again', () => {
  test('can create when the profile writes the word into the field the probe reads', async () => {
    anki.activeProfile = profile({ key: 'Expression', fields: [{ key: 'Expression', value: '{word}' }] });
    const m = await mining();
    await m.probeMined();

    await m.mineSentence();

    expect(anki.addResultToAnki.mock.calls[0]![1]).toMatchObject({ create: true, method: 'word_card_create' });
  });

  test('counts {word-furigana}, because the probe looks for that spelling too', async () => {
    anki.activeProfile = profile({ key: 'Expression', fields: [{ key: 'Expression', value: '{word-furigana}' }] });
    const m = await mining();
    await m.probeMined();

    await m.mineSentence();

    expect(anki.addResultToAnki.mock.calls[0]![1]).toMatchObject({ create: true });
  });

  test('does NOT create for a Yomitan setup, where the key field is not mapped here', async () => {
    // Yomitan already filled it. Creating would be the worst of both: a second,
    // emptier note beside the one Yomitan just made.
    anki.activeProfile = profile({ key: 'Expression', fields: [{ key: 'Sentence', value: '{sentence-jp}' }] });
    const m = await mining();
    await m.probeMined();

    await m.mineSentence();

    expect(anki.addResultToAnki.mock.calls[0]![1]).toMatchObject({ create: false, method: 'word_card_last' });
  });

  test('does not create when the key field writes something other than the word', async () => {
    // The note would be invisible to the next probe, and invisible means a
    // duplicate per visit.
    anki.activeProfile = profile({ key: 'Expression', fields: [{ key: 'Expression', value: '{sentence-jp}' }] });
    const m = await mining();
    await m.probeMined();

    await m.mineSentence();

    expect(anki.addResultToAnki.mock.calls[0]![1]).toMatchObject({ create: false });
  });
});

describe('mining a sentence', () => {
  test('improves the note the probe already found, rather than making another', async () => {
    // A word mined last month is found again rather than duplicated.
    anki.executeAction.mockResolvedValue(found([42]));
    const m = await mining();
    await m.probeMined();

    await m.mineSentence();

    expect(anki.addResultToAnki.mock.calls[0]![1]).toMatchObject({ noteId: 42, method: 'word_card_note' });
  });

  test('names the context-only export separately, so the two can be told apart', async () => {
    anki.executeAction.mockResolvedValue(found([42]));
    const m = await mining();
    await m.probeMined();

    await m.mineSentence({ wordFields: false });

    expect(anki.addResultToAnki.mock.calls[0]![1]).toMatchObject({ wordFields: false, method: 'word_card_context' });
  });

  test('refuses while a mine is already running', async () => {
    let release: (value: unknown) => void = () => {};
    anki.addResultToAnki.mockReturnValue(new Promise((resolve) => (release = resolve)));
    const m = await mining();

    const first = m.mineSentence();
    await m.mineSentence();

    expect(anki.addResultToAnki).toHaveBeenCalledTimes(1);
    release(undefined);
    await first;
  });

  test('refuses when the profile cannot mine at all', async () => {
    anki.activeProfile = profile({ model: undefined });

    await (await mining()).mineSentence();

    expect(anki.addResultToAnki).not.toHaveBeenCalled();
  });

  test('gives Anki another chance, because the reader asked for it by name', async () => {
    // The breaker exists to stop pointless probes, not to lock the feature out
    // for the rest of the session once Anki is finally running.
    anki.executeAction.mockResolvedValueOnce(null);
    const m = await mining();
    await m.probeMined();
    anki.executeAction.mockResolvedValue(found([]));

    await m.mineSentence();

    expect(anki.addResultToAnki).toHaveBeenCalled();
  });

  test('RE-PROBES afterwards rather than assuming the star was earned', async () => {
    // The last-added path may have written to a note for an entirely different
    // word, so the star has to be earned by the collection saying so.
    const m = await mining();
    await m.probeMined();
    anki.executeAction.mockClear();
    anki.executeAction.mockResolvedValue(found([99]));

    await m.mineSentence();

    expect(m.minedNoteId.value).toBe(99);
  });

  test('the re-probe is NOT reported, since it is bookkeeping rather than a question', async () => {
    // It runs at the one moment the answer is almost guaranteed to be "mined",
    // so counting it would inflate the mined rate by exactly the number of
    // times readers used the button.
    const m = await mining();
    await m.probeMined();
    posthog.capture.mockClear();

    await m.mineSentence();

    expect(posthog.capture).not.toHaveBeenCalled();
  });

  test('does not re-probe when the card has moved on', async () => {
    // An export takes seconds -- it uploads the audio and the still -- which is
    // long enough for the reader to have opened another word, and re-probing
    // then would answer the new card with the previous word's collection.
    const m = await mining('手加減');
    anki.addResultToAnki.mockImplementation(async () => m.moveTo('別の言葉'));
    anki.executeAction.mockClear();

    await m.mineSentence();

    expect(anki.executeAction).not.toHaveBeenCalled();
  });

  test('clears the in-flight flag even when the export threw', async () => {
    // Otherwise the button is disabled for the rest of the card's life.
    anki.addResultToAnki.mockRejectedValue(new Error('anki closed'));
    const m = await mining();

    await m.mineSentence().catch(() => {});

    expect(m.mining.value).toBe(false);
  });
});

describe('opening the note a word is already in', () => {
  test('brings Anki’s browser forward on it', async () => {
    anki.executeAction.mockResolvedValue(found([42]));
    const m = await mining();
    await m.probeMined();

    await m.openMinedNote();

    expect(anki.guiBrowse).toHaveBeenCalledWith('nid:42');
  });

  test('does nothing when the word is not mined', async () => {
    const m = await mining();

    await m.openMinedNote();

    expect(anki.guiBrowse).not.toHaveBeenCalled();
  });
});
