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
  vocabIndex: 0,
  furigana: [{ text: '食', ruby: 'た' }, { text: 'べました' }],
  inflection: { labels: ['past', 'polite'], base: '食べる' },
  components: [
    { surface: '食べ', offset: 0, length: 2 },
    { surface: 'まし', offset: 2, length: 2 },
    { surface: 'た', offset: 4, length: 1 },
  ],
};

describe('toSlimToken', () => {
  it('fills the ten published fields', () => {
    const token = toSlimToken(INFLECTED, '食べる-たべる');

    expect(token.s).toBe('食べました');
    expect(token.d).toBe('食べる');
    expect(token.r).toBe('タベマシタ');
    expect(token.b).toBe(11);
    expect(token.e).toBe(16);
    expect(token.p).toBe('動詞');
    expect(token.p4).toBe('下一段-バ行');
    expect(token.cf).toBe('連用形-一般');
  });

  // Our schema types these four nullable with minLength 1, so neither placeholder
  // may travel: "*" would fail our own published spec, and 一般 would print a
  // sub-POS with no meaning beside nearly every verb in the corpus.
  // The five UniDic fields all come off posFull, and /v1/parse did not return it
  // at first: every stored token had an empty p/p1/p2/p4/cf, which is five of the
  // ten our schema calls required. Nothing caught it until real rows were written.
  it('fills every published field, none of them blank', () => {
    const token = toSlimToken(INFLECTED, undefined);

    expect(token.p).toBe('動詞');
    expect(token.p).not.toBe('');
    expect(token.posLabel).toBe('Verb');
  });

  it('drops Sudachi placeholders rather than passing them through', () => {
    const token = toSlimToken(INFLECTED, undefined);

    expect(token.p1).toBeUndefined(); // 一般
    expect(token.p2).toBeUndefined(); // *
  });

  it('positions parts against the sentence, not against the token', () => {
    const token = toSlimToken(INFLECTED, undefined);

    expect(token.parts).toEqual([
      { s: '食べ', b: 11, e: 13 },
      { s: 'まし', b: 13, e: 15 },
      { s: 'た', b: 15, e: 16 },
    ]);
    expect(token.parts?.[0]?.b).toBe(token.b);
    expect(token.parts?.at(-1)?.e).toBe(token.e);
  });

  it('carries the ruby, the inflection chain and the word id', () => {
    const token = toSlimToken(INFLECTED, '食べる-たべる');

    expect(token.f).toEqual([
      { t: '食', r: 'た' },
      { t: 'べました', r: undefined },
    ]);
    expect(token.inflection).toEqual({ labels: ['past', 'polite'], base: '食べる' });
    expect(token.wid).toBe('食べる-たべる');
  });

  it('omits the word id rather than inventing one', () => {
    expect(toSlimToken(INFLECTED, undefined).wid).toBeUndefined();
  });

  // A symbol reads as itself and `r` is a required string, so the surface stands
  // in. A token with no ruby and no parts carries neither key.
  it('handles a bare symbol', () => {
    const token = toSlimToken({ position: 16, length: 1, surface: '。', posFull: ['補助記号'] }, undefined);

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
    vocabulary: [],
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
