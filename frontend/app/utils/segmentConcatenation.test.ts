import { describe, it, expect } from 'vitest';

import type { SearchResult, Segment } from '~/types/search';
import { buildExpandedTexts, orderAudioUrls, pickNeighbours } from './segmentConcatenation';

const segment = (publicId: string, ja: string): SearchResult =>
  ({
    media: { publicId: 'media-1' },
    segment: {
      publicId,
      textJa: { content: ja, highlight: ja, tokens: [{ surface: ja }] },
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

  it('wraps the pulled-in neighbours and keeps the original in the middle', () => {
    const texts = buildExpandedTexts(current, context[0]!, context[2]!);
    expect(texts.textJa.content).toBe('<span class="text-cyan-200">一</span> 二 <span class="text-cyan-200">三</span>');
  });

  it('drops a missing side rather than joining an empty span', () => {
    const texts = buildExpandedTexts(current, null, context[2]!);
    expect(texts.textJa.content).toBe('二 <span class="text-cyan-200">三</span>');
    expect(texts.textJa.content).not.toContain('<span class="text-cyan-200"></span>');
    expect(texts.textJa.content.startsWith(' ')).toBe(false);
  });

  it('expands every language, not just Japanese', () => {
    const texts = buildExpandedTexts(current, context[0]!, null);
    expect(texts.textEn.content).toBe('<span class="text-cyan-200">一-en</span> 二-en');
    expect(texts.textEs.content).toBe('<span class="text-cyan-200">一-es</span> 二-es');
  });

  it('clears the Japanese tokens, which no longer line up with the merged text', () => {
    const texts = buildExpandedTexts(current, context[0]!, context[2]!);
    expect((texts.textJa as { tokens: unknown }).tokens).toBeNull();
  });

  it('does not mutate the segment it expands', () => {
    buildExpandedTexts(current, context[0]!, context[2]!);
    expect(current.textJa.content).toBe('二');
    expect(current.textJa.tokens).toHaveLength(1);
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
