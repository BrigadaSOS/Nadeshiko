import { describe, test, expect, vi, beforeEach } from 'vitest';

/**
 * The card's lookup: the cache read, the request, and the staleness guard.
 *
 * Every case here is one the component could only reach by being mounted, and
 * two of them are bugs the comments in the original describe as having survived
 * a long time precisely because they are silent:
 *
 * - A CACHED ANSWER PAINTS SYNCHRONOUSLY. If it went through the request path
 *   the card would flash "Looking up…" for a frame on every word the reader has
 *   already seen.
 * - STALENESS IS JUDGED ON THE WORD, NOT THE TOKEN OBJECT. The token list is a
 *   computed and rebuilds its objects on any re-render, so an identity check
 *   threw away answers for exactly the word on screen -- and left the card
 *   reading "Looking up…" over a request that had returned 200.
 */
const peekWord = vi.fn();
const fetchWord = vi.fn();
vi.mock('~/utils/wordLookup', () => ({
  peekWord: (...a: unknown[]) => peekWord(...a),
  fetchWord: (...a: unknown[]) => fetchWord(...a),
}));

const { useWordLookup } = await import('./useWordLookup');

const REF = { lemma: '猫', surface: '猫', reading: 'ねこ', pos: '名詞' };
const OTHER = { lemma: '犬', surface: '犬', reading: 'いぬ', pos: '名詞' };

const answer = (candidates: unknown[], reason: string | null = null, nameOnly = false) =>
  ({ candidates, reason, nameOnly }) as never;

const CAT = answer([{ headword: '猫' }]);

beforeEach(() => {
  peekWord.mockReset();
  fetchWord.mockReset();
  peekWord.mockReturnValue(undefined);
});

function lookup() {
  const applied = vi.fn();
  return { applied, ...useWordLookup(() => 'en', applied) };
}

describe('a word the page already has', () => {
  test('paints without a request and without passing through loading', async () => {
    peekWord.mockReturnValue(CAT);
    const l = lookup();

    const promise = l.lookUp(REF);

    // Before awaiting: the cached path must be synchronous, or the card blinks.
    expect(l.candidates.value).toHaveLength(1);
    expect(l.wordState.value).toBe('idle');

    expect(await promise).toEqual({ answer: CAT, fromCache: true });
    expect(fetchWord).not.toHaveBeenCalled();
  });
});

describe('a word it has to ask for', () => {
  test('says so while it waits, then paints the answer', async () => {
    let settle: (v: unknown) => void = () => {};
    fetchWord.mockReturnValue(new Promise((resolve) => (settle = resolve)));
    const l = lookup();

    const promise = l.lookUp(REF);
    expect(l.wordState.value).toBe('loading');

    settle(CAT);
    const outcome = await promise;

    expect(outcome).toEqual({ answer: CAT, fromCache: false });
    expect(l.word.value).toEqual({ headword: '猫' });
    expect(l.applied).toHaveBeenCalled();
  });

  test('an answer for a word the reader has moved off is discarded', async () => {
    const first = Promise.withResolvers<unknown>();
    const second = Promise.withResolvers<unknown>();
    fetchWord.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const l = lookup();

    const stale = l.lookUp(REF);
    const current = l.lookUp(OTHER);

    const DOG = answer([{ headword: '犬' }]);
    second.resolve(DOG);
    await current;
    first.resolve(CAT);

    // Null, so the caller records no outcome for it -- and the card still shows
    // the word the reader is actually looking at.
    expect(await stale).toBeNull();
    expect(l.word.value).toEqual({ headword: '犬' });
  });

  test('the same word twice is not stale, however often the tokens rebuild', async () => {
    // Two DIFFERENT ref objects for one word: identity would call the second
    // stale, which is the bug the string identity exists to prevent.
    fetchWord.mockResolvedValue(CAT);
    const l = lookup();

    const outcome = await l.lookUp({ ...REF });

    expect(outcome?.answer).toBe(CAT);
    expect(l.word.value).toEqual({ headword: '猫' });
  });
});

describe('what the card says about the answer', () => {
  test('an empty answer is "no such word"', async () => {
    fetchWord.mockResolvedValue(answer([], 'missing'));
    const l = lookup();

    await l.lookUp(REF);

    expect(l.wordState.value).toBe('missing');
  });

  test('a dictionary that could not be reached says so instead', async () => {
    // Distinct from 'missing' on purpose: the dictionary did not answer "no",
    // it did not answer.
    fetchWord.mockResolvedValue(answer([], 'failed'));
    const l = lookup();

    await l.lookUp(REF);

    expect(l.wordState.value).toBe('unavailable');
  });

  test('a token that is only ever a person is named, not called missing', async () => {
    // The lie this state was added to stop: 明日香 is in the dictionary, we drop
    // names only while a real word competes with them.
    fetchWord.mockResolvedValue(answer([{ headword: '明日香' }], null, true));
    const l = lookup();

    await l.lookUp(REF);

    expect(l.wordState.value).toBe('name');
  });

  test('an answer with senses needs no state of its own', async () => {
    fetchWord.mockResolvedValue(CAT);
    const l = lookup();

    await l.lookUp(REF);

    expect(l.wordState.value).toBe('idle');
  });
});

describe('clearing between words', () => {
  test('drops the pick, so the next token does not open on a second candidate', async () => {
    peekWord.mockReturnValue(answer([{ headword: '黄身' }, { headword: '君' }]));
    const l = lookup();
    await l.lookUp(REF);
    l.picked.value = 1;

    l.clearLookup();

    expect(l.picked.value).toBe(0);
    expect(l.candidates.value).toHaveLength(0);
    expect(l.othersOpen.value).toBe(false);
  });

  test('a request abandoned in flight does not strand the next open on "loading"', async () => {
    const inflight = Promise.withResolvers<unknown>();
    fetchWord.mockReturnValue(inflight.promise);
    const l = lookup();
    const abandoned = l.lookUp(REF);

    // The reader closed the card.
    l.cancelPending();
    l.clearLookup();
    inflight.resolve(CAT);

    expect(await abandoned).toBeNull();
    expect(l.wordState.value).toBe('idle');
  });
});
