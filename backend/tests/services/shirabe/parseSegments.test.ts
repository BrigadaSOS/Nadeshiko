import { describe, it, expect, vi, afterEach } from 'vitest';
import { __testing, parseSegments } from '@app/services/shirabe/parseSegments';

const { toSlimToken } = __testing;

// This mapping is the only place Shirabe's answer becomes one of our tokens, and
// both the corpus backfill and every new episode come through it. The ten short
// fields are our published contract (OpenAPI, npm and PyPI SDKs, third-party Anki
// note types), so what is tested here is that they keep meaning what they say.

const INFLECTED = {
  position: 11,
  length: 5,
  surface: '食べました',
  lemma: '食べる',
  reading: 'タベマシタ',
  posFull: ['動詞', '一般', '*', '*', '下一段-バ行', '連用形-一般'],
  kind: 'inflected',
  posLabel: 'Verb',
  furigana: [{ text: '食', ruby: 'た' }, { text: 'べました' }],
  inflection: { labels: ['past', 'polite'], base: '食べる' },
  components: [
    { surface: '食べ', offset: 0, length: 2 },
    { surface: 'まし', offset: 2, length: 2 },
    { surface: 'た', offset: 4, length: 1 },
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

  // p1/p2/p4/cf are gone. They were named for UniDic array indices -- with no p3,
  // and pos[5] called `cf` -- which is Sudachi's internal shape leaking into a
  // published contract, and nothing read them: `posLabel` says what they were
  // kept to say, in words, without a UniDic table at the other end.
  it('keeps no UniDic slot beyond the primary tag', () => {
    const token = toSlimToken(INFLECTED);

    for (const slot of ['p1', 'p2', 'p3', 'p4', 'cf']) {
      expect(token).not.toHaveProperty(slot);
    }
  });

  // `p` comes off posFull, and /api/v1/parse did not always return it: every
  // stored token had an empty `p`, a field the schema calls required. Nothing
  // caught it until real rows were written, so it is asserted non-blank rather
  // than merely present.
  it('leaves no published field blank', () => {
    const token = toSlimToken(INFLECTED);

    expect(token.p).toBe('動詞');
    expect(token.p).not.toBe('');
    expect(token.posLabel).toBe('Verb');
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

  // Everything the live resolve needs has to survive the mapping, or the card
  // cannot ask about an inflected word (食べました reaches 食べる, which no slug
  // spells) or tell one homograph from another (開く by reading).
  it('keeps what a live lookup resolves from', () => {
    const token = toSlimToken(INFLECTED);

    expect(token.d).toBe('食べる');
    expect(token.s).toBe('食べました');
    expect(token.r).toBeTruthy();
    expect(token.p).toBe('動詞');
  });

  // A symbol reads as itself and `r` is a required string, so the surface stands
  // in. A token with no ruby and no parts carries neither key.
  it('handles a bare symbol', () => {
    const token = toSlimToken({ position: 16, length: 1, surface: '。', posFull: ['補助記号'] });

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
  });

  /** A response whose single token's surface is the text that was sent. */
  const echoResponse = (texts: string[]) => ({
    tokens: texts.map((text) => [{ position: 0, length: text.length, surface: text, pos: 'noun' }]),
  });

  it('returns one entry per input, in input order, when later batches answer first', async () => {
    const { PARSE_BATCH } = __testing;
    // Three batches, so there is a middle one to get out of order.
    const texts = Array.from({ length: PARSE_BATCH * 2 + 5 }, (_, i) => `文${i}`);

    let call = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      const sent = JSON.parse(String((init as RequestInit).body)).texts as string[];
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

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      const sent = JSON.parse(String((init as RequestInit).body)).texts as string[];
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

  it('answers an empty input without calling Shirabe', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    await expect(parseSegments([])).resolves.toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
