import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { WordRef } from '~/utils/wordLookup';

/**
 * `wordLookup` keeps its cache in module-scoped `Map`s, so every test needs a
 * fresh copy of the module rather than a fresh object. Hence the dynamic import
 * after `resetModules` instead of a top-level one.
 */
type WordLookupModule = typeof import('~/utils/wordLookup');

let mod: WordLookupModule;
let fetchMock: ReturnType<typeof vi.fn>;

const ref = (lemma: string): WordRef => ({ lemma, surface: lemma, reading: lemma, pos: 'noun' }) as unknown as WordRef;

/** One candidate, standing in for the ranked list `words/identify` answers with.
 *  Keyed by the locale the request asked for, so a test can tell two locales'
 *  answers apart without caring what a real candidate looks like. */
const candidate = (locale: string) => ({ id: locale, headword: locale }) as unknown as Record<string, unknown>;

/** `nameOnly` rides on every successful answer: it is what tells the card that a
 *  list of candidates is a person rather than a word. False here, since these
 *  fixtures are ordinary words. */
const answer = (locale: string) => ({ candidates: [candidate(locale)], nameOnly: false });

/** ofetch reports the status in two places; the module reads both. */
const httpError = (status: number) => Object.assign(new Error(`HTTP ${status}`), { statusCode: status });

beforeEach(async () => {
  vi.resetModules();
  fetchMock = vi.fn(async (_url: string, opts: { query: { locale: string } }) => answer(opts.query.locale));
  vi.stubGlobal('$fetch', fetchMock);
  mod = await import('~/utils/wordLookup');
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('peekWord', () => {
  it('answers undefined for a word nobody has asked about', () => {
    expect(mod.peekWord(ref('猫'), 'en')).toBeUndefined();
  });

  it('answers from cache once the word has been fetched', async () => {
    await mod.fetchWord(ref('猫'), 'en');
    expect(mod.peekWord(ref('猫'), 'en')).toEqual(answer('en'));
  });
});

describe('fetchWord', () => {
  it('asks once and serves the rest from cache', async () => {
    await mod.fetchWord(ref('猫'), 'en');
    await mod.fetchWord(ref('猫'), 'en');

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('coalesces callers that arrive while the request is in flight', async () => {
    const [a, b] = await Promise.all([mod.fetchWord(ref('猫'), 'en'), mod.fetchWord(ref('猫'), 'en')]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(a).toEqual(b);
  });

  // The same lemma in two gloss languages is two different answers. Sharing one
  // would show a reader the wrong language and look like a translation bug.
  it('keeps one answer per locale', async () => {
    const en = await mod.fetchWord(ref('猫'), 'en');
    const es = await mod.fetchWord(ref('猫'), 'es');

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(en).not.toEqual(es);
  });

  it('remembers a 404, because the word will still have no entry next time', async () => {
    fetchMock.mockRejectedValue(httpError(404));

    expect(await mod.fetchWord(ref('猫'), 'en')).toEqual({ candidates: [], reason: 'missing' });
    await mod.fetchWord(ref('猫'), 'en');

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  // Identify answers 200 with `words: [null]` for a token that resolves to
  // nothing, and the server route turns that into a 404 -- but a response that
  // arrives with an empty list has to read the same way, or the card treats "no
  // candidates" as a successful lookup and sits on a blank instead of saying
  // there is no entry.
  it('reads an empty candidate list as "no entry", not as a successful lookup', async () => {
    fetchMock.mockResolvedValue({ candidates: [] });

    // The reason matters as much as the emptiness: the card says "no dictionary
    // entry" off it, and `word_card_opened` reports it as the outcome. Without
    // one, both go blank on an answer the dictionary actually gave.
    expect(await mod.fetchWord(ref('猫'), 'en')).toEqual({ candidates: [], reason: 'missing' });
  });

  // The distinction that matters: caching a failure pins the word blank for the
  // rest of the session, recoverable only by reloading the page.
  it('does not remember a failure, so the next hover retries', async () => {
    fetchMock.mockRejectedValueOnce(httpError(502));

    expect(await mod.fetchWord(ref('猫'), 'en')).toEqual({ candidates: [], reason: 'failed' });
    expect(mod.peekWord(ref('猫'), 'en')).toBeUndefined();

    expect(await mod.fetchWord(ref('猫'), 'en')).toEqual(answer('en'));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

/**
 * The bound is the whole reason this cache is safe on a long-lived SSR worker:
 * without it the map grows for the life of the process, a few KB per distinct
 * word, and an evening of reading is tens of megabytes nobody is looking at.
 */
describe('cache bound', () => {
  it('drops the least recently used entry once past the limit', async () => {
    const limit = mod.__testing.CACHE_LIMIT;

    for (let i = 0; i < limit; i++) {
      await mod.fetchWord(ref(`word-${i}`), 'en');
    }

    // Deliberately not peeking `word-0` first to prove it is there: `peekWord`
    // goes through `recall`, which re-inserts, so checking it would move it to
    // the back and save it from the very eviction under test. That the
    // assertion below fails when you add that check is the LRU working.
    await mod.fetchWord(ref('one-too-many'), 'en');

    expect(mod.peekWord(ref('word-0'), 'en')).toBeUndefined();
    expect(mod.peekWord(ref('one-too-many'), 'en')).toBeDefined();
  });

  it('protects an entry that was read recently', async () => {
    const limit = mod.__testing.CACHE_LIMIT;

    for (let i = 0; i < limit; i++) {
      await mod.fetchWord(ref(`word-${i}`), 'en');
    }

    // Reading moves it to the back of the queue, so the next eviction should
    // take word-1 instead. Without the re-insert in `recall` this is FIFO and
    // the entry a reader keeps returning to is the one that keeps being dropped.
    expect(mod.peekWord(ref('word-0'), 'en')).toBeDefined();

    await mod.fetchWord(ref('one-too-many'), 'en');

    expect(mod.peekWord(ref('word-0'), 'en')).toBeDefined();
    expect(mod.peekWord(ref('word-1'), 'en')).toBeUndefined();
  });

  it('does not count a repeated word twice', async () => {
    const limit = mod.__testing.CACHE_LIMIT;

    for (let i = 0; i < limit; i++) {
      await mod.fetchWord(ref('same-word'), 'en');
    }

    expect(mod.peekWord(ref('same-word'), 'en')).toBeDefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

/**
 * A linked reader changing their dictionaries in Shirabe, mid-page.
 *
 * The session is read once per page load, so without this the reader would keep
 * being served every word they had already hovered from a day-old copy until
 * they reloaded -- on the very page where Shirabe told us it had changed.
 */
describe('a stack that changes under the reader', () => {
  it('re-keys the cache when Shirabe reports a different stack', async () => {
    mod.setReaderStack('old-stack');
    fetchMock.mockResolvedValue({ ...answer('en'), stackFingerprint: 'new-stack' });

    await mod.fetchWord(ref('猫'), 'en');

    // The answer is filed under the stack it really came from, so the entry the
    // reader gets next is the fresh one rather than the one they just replaced.
    expect(mod.peekWord(ref('猫'), 'en')).toBeDefined();
    expect(mod.__testing.cacheKey(ref('猫'), 'en', 'new-stack')).not.toBe(
      mod.__testing.cacheKey(ref('猫'), 'en', 'old-stack'),
    );
  });

  // Everything cached under the old stack came from dictionaries that may no
  // longer be the reader's. None of it may survive the change.
  it('drops the answers that came from the stack it replaced', async () => {
    mod.setReaderStack('old-stack');
    fetchMock.mockResolvedValue(answer('en'));
    await mod.fetchWord(ref('犬'), 'en');
    expect(mod.peekWord(ref('犬'), 'en')).toBeDefined();

    fetchMock.mockResolvedValue({ ...answer('en'), stackFingerprint: 'new-stack' });
    await mod.fetchWord(ref('猫'), 'en');

    expect(mod.peekWord(ref('犬'), 'en')).toBeUndefined();
  });

  // The contract `plugins/shirabeStack.client.ts` exists to satisfy, pinned here
  // because breaking it is silent in the worst way. Without the fingerprint the
  // URL is byte-identical to an unlinked reader's, the response is
  // `private, max-age=86400`, and the browser answers every word out of its own
  // day-old cache: no request, no error, no log, and a reader who just changed
  // their dictionaries still reading definitions from the ones they removed.
  it('puts the stack the plugin hands it into the lookup URL', async () => {
    mod.setReaderStack('abc123');

    await mod.fetchWord(ref('猫'), 'en');

    expect(fetchMock.mock.calls[0]?.[1]?.query).toMatchObject({ stack: 'abc123' });
  });

  // The unlinked reader, which is nearly all of the traffic: the route sends no
  // fingerprint at all, and nothing about their URLs may change.
  it('leaves an unlinked reader alone', async () => {
    mod.setReaderStack(null);
    fetchMock.mockResolvedValue(answer('en'));

    await mod.fetchWord(ref('猫'), 'en');

    expect(fetchMock.mock.calls[0]?.[1]?.query).not.toHaveProperty('stack');
    expect(mod.peekWord(ref('猫'), 'en')).toBeDefined();
  });
});
