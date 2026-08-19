import { describe, expect, it } from 'vitest';
import elasticsearchSchema from 'config/elasticsearch-schema.json';

/**
 * Guards the one filter standing between romaji search and nonsense results.
 *
 * `sudachi_readingform` has no reading for Latin letters it cannot map, and it
 * emits an EMPTY STRING rather than dropping the token. Romaji with no mappable
 * vowel therefore analyses to exactly one empty token:
 *
 *   zzqxwvfjkl  ->  ['']
 *   qxwvfjkl    ->  ['']
 *
 * Both queries then become `textJa.kana:""`, which matches every document whose
 * own indexed reading contains an unreadable token -- 1,272 of 33,085 locally,
 * 8,082 on production. The reader typed gibberish and got thousands of unrelated
 * sentences, every token highlighted, instead of the empty state. The two
 * queries above returned byte-identical results, which is what gave it away:
 * the leading `zz` changed nothing because the query text was gone by then.
 *
 * A `length` filter with `min: 1` drops the empty tokens, the clause analyses to
 * nothing, and Elasticsearch matches nothing -- which is the right answer.
 * Verified end to end against the pinned image before landing.
 *
 * The filter belongs on BOTH analyzers. Search-side is what fixes the query;
 * index-side keeps the empty tokens out of the index in the first place, so the
 * next reindex stops carrying terms nothing should ever match.
 */
describe('kana analyzers', () => {
  const analysis = elasticsearchSchema.settings.analysis;

  it('defines a filter that drops zero-length tokens', () => {
    expect(analysis.filter.kana_no_empty).toEqual({ type: 'length', min: 1 });
  });

  it.each(['ja_kana_index_analyzer', 'ja_kana_search_analyzer'])(
    '%s drops empty readings, immediately after the filter that creates them',
    (name) => {
      const filters = (analysis.analyzer as Record<string, { filter: string[] }>)[name].filter;

      expect(filters).toContain('kana_no_empty');
      // Order matters: an empty token has to be removed after `sudachi_readingform`
      // produces it and before anything downstream counts it as a real term.
      expect(filters.indexOf('kana_no_empty')).toBe(filters.indexOf('sudachi_reading_katakana') + 1);
    },
  );
});
