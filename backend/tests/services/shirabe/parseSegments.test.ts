import { describe, it, expect, vi, afterEach } from 'vitest';
import type { ParseToken } from '@shirabe-org/api';
import { createShirabeClient } from '@shirabe-org/api';

// OAuth issuance has its own contract suite. Keep these parser tests about
// batching and token mapping: a static generated client makes every mocked
// request below the parse request it intends to describe, not a prior token
// exchange.
vi.mock('@app/services/shirabe/serviceClient', () => ({
  shirabeServiceClient: () => createShirabeClient({ baseUrl: 'https://shirabe.test', accessToken: 'test-token' }),
}));

import { __testing, parseSegments } from '@app/services/shirabe/parseSegments';

const { toSlimToken } = __testing;
const requestBody = async (request: RequestInfo | URL, init?: RequestInit): Promise<string> =>
  request instanceof Request ? request.clone().text() : String(init?.body);

// This mapping is the only place Shirabe's answer becomes one of our tokens, and
// both the corpus backfill and every new episode come through it. The ten short
// fields are our published contract (OpenAPI, npm and PyPI SDKs, third-party Anki
// note types), so what is tested here is that they keep meaning what they say.

const INFLECTED: ParseToken = {
  startOffset: 11,
  endOffset: 16,
  surface: '食べました',
  lemma: '食べる',
  reading: 'タベマシタ',
  partOfSpeech: 'verb',
  kind: 'inflected',
  morphology: { partOfSpeech: ['動詞', '一般'], label: 'Verb' },
  furigana: [{ text: '食', ruby: 'た' }, { text: 'べました' }],
  inflection: {
    forms: [
      { code: 'past', label: 'past' },
      { code: 'polite', label: 'polite' },
    ],
    base: '食べる',
  },
  components: [
    { surface: '食べ', startOffset: 11, endOffset: 13 },
    { surface: 'まし', startOffset: 13, endOffset: 15 },
    { surface: 'た', startOffset: 15, endOffset: 16 },
  ],
};

describe('toSlimToken', () => {
  it('fills every published field', () => {
    const token = toSlimToken(INFLECTED);

    expect(token.s).toBe('食べました');
    expect(token.d).toBe('食べる');
    expect(token.r).toBe('タベマシタ');
    expect(token.b).toBe(11);
    expect(token.e).toBe(16);
    expect(token.p).toBe('動詞');
  });

  // These finer UniDic slots are not used for highlight expansion.
  it('keeps no UniDic slot beyond the primary tag', () => {
    const token = toSlimToken(INFLECTED);

    for (const slot of ['p1', 'p2', 'p3', 'p4', 'cf']) {
      expect(token).not.toHaveProperty(slot);
    }
  });

  // `p` comes off morphology, and /api/v1/parse does not return it unless asked:
  // stored token had an empty `p`, a field the schema calls required. Nothing
  // caught it until real rows were written, so it is asserted non-blank rather
  // than merely present.
  it('leaves no published field blank', () => {
    const token = toSlimToken(INFLECTED);

    expect(token.p).toBe('動詞');
    expect(token.p).not.toBe('');
  });

  it('positions parts against the sentence, not against the token', () => {
    const token = toSlimToken(INFLECTED);

    expect(token.parts).toEqual([
      { s: '食べ', b: 11, e: 13 },
      { s: 'まし', b: 13, e: 15 },
      { s: 'た', b: 15, e: 16 },
    ]);
    expect(token.parts?.[0]?.b).toBe(token.b);
    expect(token.parts?.at(-1)?.e).toBe(token.e);
  });

  it('carries the ruby and the inflection chain', () => {
    const token = toSlimToken(INFLECTED);

    expect(token.f).toEqual([
      { t: '食', r: 'た' },
      { t: 'べました', r: undefined },
    ]);
    expect(token.inflection).toEqual({ labels: ['past', 'polite'], base: '食べる' });
  });

  // A stored token addresses no dictionary entry, on purpose. The id is derived
  // from dictionary content and moves when that content or a resolution rule
  // moves, so it is what a client links with and never what a corpus keeps --
  // a reader resolves it live from the lemma, surface, reading and POS here.
  it('stores no dictionary address', () => {
    expect(toSlimToken(INFLECTED)).not.toHaveProperty('wid');
  });

  it('keeps the surface, reading, and highlight category', () => {
    const token = toSlimToken(INFLECTED);

    expect(token.d).toBe('食べる');
    expect(token.s).toBe('食べました');
    expect(token.r).toBeTruthy();
    expect(token.p).toBe('動詞');
  });

  it('does not store lookup-only part-of-speech fields', () => {
    const token = toSlimToken(INFLECTED);
    expect(token).not.toHaveProperty('pt');
    expect(token).not.toHaveProperty('posLabel');
  });

  // A symbol reads as itself and `r` is a required string, so the surface stands
  // in. A token with no ruby and no parts carries neither key.
  it('handles a bare symbol', () => {
    const token = toSlimToken({
      startOffset: 16,
      endOffset: 17,
      surface: '。',
      kind: 'symbol',
      morphology: { partOfSpeech: ['補助記号'] },
    });

    expect(token.r).toBe('。');
    expect(token.d).toBe('。');
    expect(token.f).toBeUndefined();
    expect(token.parts).toBeUndefined();
    expect(token.inflection).toBeUndefined();
  });
});

/**
 * Batches run concurrently, so the one property that cannot be left to chance is
 * that the answers still line up with what was sent. Every caller zips the result
 * back against its own rows by position -- the corpus backfill writes
 * `tokens` per segment that way -- so a reordering here silently attaches one
 * sentence's analysis to another sentence.
 */
describe('parseSegments batching', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    __testing.resetPacing();
  });

  /** A response whose single token's surface is the text that was sent. */
  const echoResponse = (texts: string[]) => ({
    stackFingerprint: 'test',
    results: texts.map((text) => ({
      text,
      tokens: [{ startOffset: 0, endOffset: text.length, surface: text, kind: 'word', partOfSpeech: 'noun' }],
    })),
  });

  /**
   * The morphology has to be asked for, and forgetting to is silent.
   *
   * Shirabe keeps furigana and morphology behind `include=`. A run without
   * this does not fail: it writes tokens with an empty `p`,
   * which reads downstream as a corpus that lost its morphology on whatever date
   * the run happened. Cheap to assert, and there is no other signal.
   */
  it('asks for the morphology it stores', async () => {
    const bodies: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (request, init) => {
      const body = await requestBody(request, init);
      bodies.push(body);
      return new Response(JSON.stringify(echoResponse(JSON.parse(body).texts)), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });

    await parseSegments(['猫が好き']);

    expect(JSON.parse(bodies[0] ?? '{}').include).toEqual(['furigana', 'morphology']);
  });

  it('returns one entry per input, in input order, when later batches answer first', async () => {
    const { PARSE_BATCH } = __testing;
    // Three batches, so there is a middle one to get out of order.
    const texts = Array.from({ length: PARSE_BATCH * 2 + 5 }, (_, i) => `文${i}`);

    let call = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (request, init) => {
      const sent = JSON.parse(await requestBody(request, init)).texts as string[];
      // Invert the delay: the last batch dispatched resolves first. With results
      // appended as they arrive rather than placed by index, this reorders.
      const delay = Math.max(0, 30 - call++ * 10);
      await new Promise((resolve) => setTimeout(resolve, delay));
      return new Response(JSON.stringify(echoResponse(sent)), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });

    const out = await parseSegments(texts);

    expect(out).toHaveLength(texts.length);
    expect(out.map((tokens) => tokens[0]?.s)).toEqual(texts);
  });

  it('sends every input exactly once across the batches', async () => {
    const { PARSE_BATCH } = __testing;
    const texts = Array.from({ length: PARSE_BATCH + 1 }, (_, i) => `文${i}`);
    const seen: string[] = [];

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (request, init) => {
      const sent = JSON.parse(await requestBody(request, init)).texts as string[];
      seen.push(...sent);
      return new Response(JSON.stringify(echoResponse(sent)), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });

    await parseSegments(texts);

    expect(seen).toHaveLength(texts.length);
    expect(new Set(seen).size).toBe(texts.length);
  });

  it("splits a batch before it exceeds Shirabe's character payload limit", async () => {
    const { PARSE_MAX_CHARS } = __testing;
    const batches: string[][] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (request, init) => {
      const texts = JSON.parse(await requestBody(request, init)).texts as string[];
      batches.push(texts);
      return new Response(JSON.stringify(echoResponse(texts)), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });

    await parseSegments(['猫'.repeat(PARSE_MAX_CHARS), '犬']);

    expect(batches).toEqual([['猫'.repeat(PARSE_MAX_CHARS)], ['犬']]);
  });

  it('answers an empty input without calling Shirabe', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    await expect(parseSegments([])).resolves.toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

/**
 * A corpus pass is ~6,600 requests over two hours against a server other people
 * are reading from. One Cloudflare 502 used to end it: `parseChunk` threw, `run`
 * unwound, and a pass died 372,000 segments in with no retry anywhere.
 */
describe('parseSegments resilience', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    __testing.resetPacing();
  });

  const echo = (texts: string[]) => ({
    stackFingerprint: 'test',
    results: texts.map((text) => ({
      text,
      tokens: [{ startOffset: 0, endOffset: text.length, surface: text, kind: 'word', partOfSpeech: 'noun' }],
    })),
  });
  const ok = (texts: string[]) =>
    new Response(JSON.stringify(echo(texts)), { status: 200, headers: { 'content-type': 'application/json' } });

  it('retries a 502 and keeps the answer', async () => {
    vi.useFakeTimers();
    let calls = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (request, init) => {
      const texts = JSON.parse(await requestBody(request, init)).texts as string[];
      calls += 1;
      if (calls === 1) return new Response('<html>502</html>', { status: 502 });
      return ok(texts);
    });

    const promise = parseSegments(['猫が好き']);
    await vi.runAllTimersAsync();

    expect((await promise)[0]?.[0]?.s).toBe('猫が好き');
    expect(calls).toBe(2);
  });

  /** A 400 is our bug and a 401 is a bad key. Neither improves on the fifth try. */
  it('does not retry a 400', async () => {
    let calls = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      calls += 1;
      return new Response('{}', { status: 400 });
    });

    await expect(parseSegments(['猫'])).rejects.toThrow('400');
    expect(calls).toBe(1);
  });

  it('gives up after RETRY_ATTEMPTS rather than retrying forever', async () => {
    vi.useFakeTimers();
    let calls = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      calls += 1;
      return new Response('<html>503</html>', { status: 503 });
    });

    const promise = parseSegments(['猫']);
    const assertion = expect(promise).rejects.toThrow('503');
    await vi.runAllTimersAsync();
    await assertion;

    expect(calls).toBe(__testing.RETRY_ATTEMPTS);
  });

  it('treats a lost connection as worth retrying and a 404 as not', () => {
    const { isTransient } = __testing;
    expect(isTransient(null)).toBe(true); // timeout, reset socket, DNS
    expect(isTransient(429)).toBe(true);
    expect(isTransient(502)).toBe(true);
    expect(isTransient(503)).toBe(true);
    expect(isTransient(404)).toBe(false);
    expect(isTransient(401)).toBe(false);
  });
});

/**
 * Concurrency 3 drove shirabe.org to 145% CPU against a ~200% ceiling and took
 * reader page loads from 0.24s to 1.6s p95, with `puma_backlog` at 0 throughout:
 * readers were not queueing for a worker, they were sharing a core with a 2.4s
 * parse. The pass now reads its own latency and yields instead.
 */
describe('parseSegments pacing', () => {
  afterEach(() => __testing.resetPacing());

  const { recordChunkTiming, inFlightLimit, PARSE_CONCURRENCY } = __testing;

  it('drops to one in flight when a chunk comes back much slower', () => {
    recordChunkTiming(200, 200); // 1ms/text, the floor
    expect(inFlightLimit()).toBe(PARSE_CONCURRENCY);

    recordChunkTiming(1_000, 200); // 5ms/text, five times the floor
    expect(inFlightLimit()).toBe(1);
  });

  /** The floor is per TEXT: a short last chunk must not look fast and reset it. */
  it('measures per text, so a short final chunk is not mistaken for speed', () => {
    recordChunkTiming(200, 200); // 1ms/text
    recordChunkTiming(20, 20); // also 1ms/text, and far shorter overall
    expect(inFlightLimit()).toBe(PARSE_CONCURRENCY);
  });

  it('climbs back one step at a time once the chunks are fast again', () => {
    recordChunkTiming(200, 200);
    recordChunkTiming(1_000, 200);
    expect(inFlightLimit()).toBe(1);

    for (let i = 0; i < 10; i++) recordChunkTiming(200, 200);
    expect(inFlightLimit()).toBe(2);

    for (let i = 0; i < 10; i++) recordChunkTiming(200, 200);
    expect(inFlightLimit()).toBe(3);
  });

  it('never climbs past the configured ceiling', () => {
    for (let i = 0; i < 100; i++) recordChunkTiming(200, 200);
    expect(inFlightLimit()).toBe(PARSE_CONCURRENCY);
  });
});
