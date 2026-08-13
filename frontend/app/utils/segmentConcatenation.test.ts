import { describe, it, expect } from 'vitest';

import type { SearchResult, Segment } from '~/types/search';
import { buildExpandedTexts, orderAudioUrls, pickNeighbours } from './segmentConcatenation';
import { enrichTokens, tokensToAnkiFurigana, type SlimToken } from './tokenEnrichment';

/** One token per character, which is enough to check that offsets are rebased
 *  onto the merged sentence and keep addressing the characters they name. */
const tokenize = (ja: string) => ja.split('').map((s, i) => ({ s, d: s, r: s, b: i, e: i + 1, p: '名詞' }));

const segment = (publicId: string, ja: string, tokens: unknown[] = tokenize(ja)): SearchResult =>
  ({
    media: { publicId: 'media-1' },
    segment: {
      publicId,
      textJa: { content: ja, highlight: ja, tokens },
      textEn: { content: `${ja}-en`, highlight: `${ja}-en`, isMachineTranslated: false },
      textEs: { content: `${ja}-es`, highlight: `${ja}-es`, isMachineTranslated: false },
      urls: { audioUrl: `https://cdn.test/${publicId}.mp3` },
    },
    blobAudio: null,
    blobAudioUrl: null,
  }) as unknown as SearchResult;

const context = [segment('a', '一'), segment('b', '二'), segment('c', '三')];

describe('pickNeighbours', () => {
  it('takes only the side the direction asks for', () => {
    expect(pickNeighbours(context, 'b', 'forward')).toMatchObject({
      before: null,
      after: context[2],
      missing: [],
    });
    expect(pickNeighbours(context, 'b', 'backward')).toMatchObject({
      before: context[0],
      after: null,
      missing: [],
    });
    expect(pickNeighbours(context, 'b', 'both')).toMatchObject({
      before: context[0],
      after: context[2],
      missing: [],
    });
  });

  it('reports the missing side at an episode boundary instead of returning nothing', () => {
    // The first segment of an episode: "expand left" has nowhere to go, and the
    // caller needs to be able to tell the reader that rather than no-op.
    const first = pickNeighbours(context, 'a', 'backward');
    expect(first).toMatchObject({ before: null, after: null, missing: ['before'] });

    const last = pickNeighbours(context, 'c', 'forward');
    expect(last).toMatchObject({ before: null, after: null, missing: ['after'] });
  });

  it('still expands the available half of an "expand both" at a boundary', () => {
    expect(pickNeighbours(context, 'a', 'both')).toMatchObject({
      before: null,
      after: context[1],
      missing: ['before'],
    });
  });

  it('returns null when the response does not contain the segment', () => {
    expect(pickNeighbours(context, 'missing-id', 'both')).toBeNull();
  });
});

describe('buildExpandedTexts', () => {
  const current = context[1]!.segment as Segment;

  it('joins the neighbours as plain text, so the token offsets stay honest', () => {
    // No cyan wrapper here, unlike the translations below: the tokens address
    // this string by offset and the Anki export slices it, so markup inside it
    // would corrupt both. The tint comes off each token's `origin` instead.
    const texts = buildExpandedTexts(current, context[0]!, context[2]!);
    expect(texts.textJa.content).toBe('一 二 三');
    expect(texts.textJa.content).not.toContain('<span');
    expect(texts.textJa.highlight).toBe('一 二 三');
  });

  it('drops a missing side rather than joining an empty gap', () => {
    const texts = buildExpandedTexts(current, null, context[2]!);
    expect(texts.textJa.content).toBe('二 三');
    expect(texts.textJa.content.startsWith(' ')).toBe(false);
  });

  it('expands every language, not just Japanese', () => {
    const texts = buildExpandedTexts(current, context[0]!, null);
    expect(texts.textEn.content).toBe('<span class="text-cyan-200">一-en</span> 二-en');
    expect(texts.textEs.content).toBe('<span class="text-cyan-200">一-es</span> 二-es');
  });

  it('rebases every token onto the merged sentence', () => {
    const texts = buildExpandedTexts(current, context[0]!, context[2]!);
    const tokens = texts.textJa.tokens as SlimToken[];

    // The whole point: each token still names the characters it covers, now
    // measured against '一 二 三' rather than against its own sentence.
    expect(tokens.map((t) => ({ s: t.s, b: t.b, e: t.e, origin: t.origin }))).toEqual([
      { s: '一', b: 0, e: 1, origin: 'before' },
      { s: '二', b: 2, e: 3, origin: 'current' },
      { s: '三', b: 4, e: 5, origin: 'after' },
    ]);
    for (const token of tokens) {
      expect(texts.textJa.content.slice(token.b, token.e)).toBe(token.s);
    }
  });

  it('shifts the sub-token parts along with their parent', () => {
    // Nothing reads `parts` yet; left on the old coordinates it would be a trap
    // for whoever first does.
    const before = segment('a', '一', [
      { s: '一', d: '一', r: '一', b: 0, e: 1, p: '名詞', parts: [{ s: '一', b: 0, e: 1 }] },
    ]);
    const texts = buildExpandedTexts(current, null, before);
    const parts = (texts.textJa.tokens as Array<{ parts?: Array<{ b: number; e: number }> }>)[1]?.parts;
    expect(parts).toEqual([{ s: '一', b: 2, e: 3 }]);
  });

  it('falls back to the wrapped merge when a segment has no analysis', () => {
    // A segment with no tokens cannot contribute offsets, so the merge has no
    // coordinates to rebase onto -- but it still has to expand, and the wrapper
    // is the only thing left to mark the pulled-in half with.
    const untokenized = segment('c', '三', []);
    const texts = buildExpandedTexts(current, null, untokenized);
    expect(texts.textJa.content).toBe('二 <span class="text-cyan-200">三</span>');
    expect((texts.textJa as { tokens: unknown }).tokens).toBeNull();
  });

  it('does not mutate the segment it expands', () => {
    buildExpandedTexts(current, context[0]!, context[2]!);
    expect(current.textJa.content).toBe('二');
    expect(current.textJa.tokens).toHaveLength(1);
    expect(current.textJa.tokens[0]).toMatchObject({ b: 0, e: 1 });
    expect(current.textJa.tokens[0]).not.toHaveProperty('origin');
  });
});

/**
 * The merged tokens run through the two things that actually consume their
 * offsets. Rebasing them is only correct if it survives these: `enrichTokens`
 * decides which words the match underline lands on by comparing `b`/`e` against
 * ranges it measures on the highlight, and `tokensToAnkiFurigana` slices the
 * content by those same numbers. Both went wrong quietly -- an underline one
 * word off, or an Anki field with the sentence sliced at the wrong character --
 * so the assertions here are on the real output of the real functions rather
 * than on the offsets in isolation.
 */
describe('expanded tokens, through the consumers that use their offsets', () => {
  /** Real-shaped sentences: multi-character tokens, furigana on the kanji, and a
   *  match in the middle sentence -- the only one a context request highlights. */
  const before = segment('a', '昨日', [
    { s: '昨日', d: '昨日', r: 'キノウ', b: 0, e: 2, p: '名詞', f: [{ t: '昨日', r: 'きのう' }] },
  ]);

  const current = segment('b', '彼女は本を読んだ', [
    { s: '彼女', d: '彼女', r: 'カノジョ', b: 0, e: 2, p: '名詞', f: [{ t: '彼女', r: 'かのじょ' }] },
    { s: 'は', d: 'は', r: 'ハ', b: 2, e: 3, p: '助詞' },
    { s: '本', d: '本', r: 'ホン', b: 3, e: 4, p: '名詞', f: [{ t: '本', r: 'ほん' }] },
    { s: 'を', d: 'を', r: 'ヲ', b: 4, e: 5, p: '助詞' },
    { s: '読んだ', d: '読む', r: 'ヨンダ', b: 5, e: 8, p: '動詞', f: [{ t: '読', r: 'よ' }, { t: 'んだ' }] },
  ]);
  // The reader searched for 本, so Elasticsearch marks it -- in this sentence
  // only. Its neighbours come from a context request, which carries no query.
  current.segment.textJa.highlight = '彼女は<em>本</em>を読んだ';

  const after = segment('c', 'そうです', [
    { s: 'そう', d: 'そう', r: 'ソウ', b: 0, e: 2, p: '副詞' },
    { s: 'です', d: 'だ', r: 'デス', b: 2, e: 4, p: '助動詞' },
  ]);

  const expanded = buildExpandedTexts(current.segment as Segment, before, after);
  const tokens = expanded.textJa.tokens as SlimToken[];

  it('leaves every token addressing the characters it names', () => {
    expect(expanded.textJa.content).toBe('昨日 彼女は本を読んだ そうです');
    for (const token of tokens) {
      expect(expanded.textJa.content.slice(token.b, token.e)).toBe(token.s);
    }
  });

  it('keeps the highlight strippable back to the content', () => {
    // The invariant `enrichTokens` rests on: it measures character positions on
    // the highlight and compares them against offsets into the content, so the
    // two must differ by nothing but the `<em>` marks.
    expect(expanded.textJa.highlight?.replace(/<\/?em>/g, '')).toBe(expanded.textJa.content);
  });

  it('lands the match on the word that was searched for, and only it', () => {
    const enriched = enrichTokens(tokens, expanded.textJa.highlight);
    expect(enriched.filter((t) => t.matchType === 'match').map((t) => t.s)).toEqual(['本']);
    expect(enriched.filter((t) => t.matchType === 'partial')).toEqual([]);
  });

  it('tints exactly the pulled-in halves', () => {
    const tinted = tokens.filter((t) => t.origin !== 'current').map((t) => t.s);
    expect(tinted).toEqual(['昨日', 'そう', 'です']);
  });

  it('exports the whole merged sentence as Anki furigana', () => {
    // Every reading over the word it belongs to, across all three sentences --
    // the export that was unavailable while expanded, because the tokens it
    // needs were being thrown away.
    expect(tokensToAnkiFurigana(expanded.textJa.content, tokens)).toBe(
      '昨日[きのう] 彼女[かのじょ]は 本[ほん]を 読[よ]んだ そうです',
    );
  });
});

describe('orderAudioUrls', () => {
  const current = context[1]!.segment as Segment;

  it('orders the objects the way they will be heard', () => {
    expect(orderAudioUrls(current, context[0]!, context[2]!)).toEqual([
      'https://cdn.test/a.mp3',
      'https://cdn.test/b.mp3',
      'https://cdn.test/c.mp3',
    ]);
  });

  it('keeps the segment itself when there is no neighbour', () => {
    expect(orderAudioUrls(current, null, null)).toEqual(['https://cdn.test/b.mp3']);
  });
});
