import { describe, expect, it } from 'vitest';
import elasticsearchSchema from 'config/elasticsearch-schema.json';

/** `sudachi_readingform` emits an empty token for unmappable romaji; without the length filter, gibberish becomes
 * `textJa.kana:""` and matches unrelated documents. Put `min: 1` on both query and index analyzers so empty terms
 * are neither searched nor indexed. */
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
