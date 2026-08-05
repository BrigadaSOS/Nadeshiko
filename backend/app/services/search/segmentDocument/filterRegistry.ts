import type { estypes } from '@elastic/elasticsearch';
import type { SearchFiltersOutput } from 'generated/outputTypes';
import type { ResolvedMediaFilterItem, ResolvedSearchFilters } from '@app/controllers/searchFilters';

/**
 * The single place that knows which request filter narrows which Elasticsearch field.
 *
 * Every filter used to be its own hand-written `if` block appending a clause, which
 * meant the filter-to-field mapping existed only as procedure: adding a filter meant
 * editing a method, and the two numeric range filters were the same eight lines twice.
 * Declaring them as data instead means the field mapping can be read at a glance, and
 * the clause-building code is written once per *kind* of filter rather than once per
 * filter.
 *
 * Clause order within `filter` is preserved exactly as it was, because it is part of
 * the cache key: `SegmentQuery.buildSearchStatsCacheKey` hashes the built query, so a
 * reordering that changes nothing semantically would still invalidate every cached
 * search-stats entry at once.
 */

/** Filters read as `{ min?, max? }` and applied as a `range` over one numeric field. */
const RANGE_FILTERS = [
  { key: 'segmentLengthChars', field: 'characterCount' },
  { key: 'segmentDurationMs', field: 'durationMs' },
] as const satisfies ReadonlyArray<{ key: keyof SearchFiltersOutput; field: string }>;

/** Filters read as a value list and applied as `terms` over one keyword field. */
const TERMS_FILTERS = [
  // Expanded to both cases, since the index holds a mix of them. See below.
  { key: 'contentRating', field: 'contentRating', expand: expandContentRatingTerms },
  { key: 'category', field: 'category', expand: null },
] as const satisfies ReadonlyArray<{
  key: keyof SearchFiltersOutput;
  field: string;
  expand: ((values: string[]) => string[]) | null;
}>;

type NumericRange = { min?: number; max?: number } | undefined;

/**
 * A `range` clause, or null when neither bound was given.
 *
 * `min`/`max` are checked against `undefined` rather than for truthiness: a bound of
 * 0 is meaningful (a zero-length segment, a zero-duration segment) and truthiness
 * would silently drop it.
 */
function buildRangeClause(field: string, range: NumericRange): estypes.QueryDslQueryContainer | null {
  if (range?.min === undefined && range?.max === undefined) return null;

  const bounds: { gte?: number; lte?: number } = {};
  if (range?.min !== undefined) bounds.gte = range.min;
  if (range?.max !== undefined) bounds.lte = range.max;

  return { range: { [field]: bounds } };
}

/**
 * Both cases of each content rating.
 *
 * `contentRating` is a `keyword` field, so `terms` matches bytes exactly and the
 * index holds a mix of cases. Emitting both spellings is what makes the filter
 * case-insensitive without reindexing or a normalizer on the mapping.
 */
export function expandContentRatingTerms(contentRating: string[]): string[] {
  const values = new Set<string>();
  for (const rating of contentRating) {
    values.add(rating.toUpperCase());
    values.add(rating.toLowerCase());
  }
  return [...values];
}

/**
 * Matches any of the given media, optionally narrowed to specific episodes.
 *
 * Takes resolved items only. It matches on the internal `mediaId`, which the wire
 * shape does not carry -- passing an unresolved filter here produced
 * `term: { mediaId: undefined }`, matching nothing while reporting no error.
 */
export function buildMediaFilter(items: readonly ResolvedMediaFilterItem[]): estypes.QueryDslQueryContainer {
  const mediaQueries: estypes.QueryDslQueryContainer[] = items.flatMap((item) => {
    if (!item.episodes || item.episodes.length === 0) {
      return { bool: { must: [{ term: { mediaId: { value: item.mediaId } } }] } };
    }
    return item.episodes.map((episode) => ({
      bool: {
        must: [{ term: { mediaId: { value: item.mediaId } } }, { term: { episode: { value: episode } } }],
      },
    }));
  });

  return { bool: { should: mediaQueries } };
}

/**
 * Every filter that applies to any segment search, as `filter` and `must_not` clauses.
 *
 * Requires filters whose media entries have been resolved to internal ids -- see
 * `ResolvedSearchFilters`.
 */
export function buildCommonFilters(filters: ResolvedSearchFilters<SearchFiltersOutput>): {
  filter: estypes.QueryDslQueryContainer[];
  must_not: estypes.QueryDslQueryContainer[];
} {
  const filter: estypes.QueryDslQueryContainer[] = [];
  const must_not: estypes.QueryDslQueryContainer[] = [];

  // Status is the one filter with no "absent" case: every search is scoped to a
  // status set, and the request schema supplies the default.
  filter.push({ terms: { status: filters.status } });

  for (const { key, field } of RANGE_FILTERS) {
    const clause = buildRangeClause(field, filters[key] as NumericRange);
    if (clause) filter.push(clause);
  }

  if (filters.media?.include && filters.media.include.length > 0) {
    filter.push(buildMediaFilter(filters.media.include));
  }

  if (filters.media?.exclude && filters.media.exclude.length > 0) {
    must_not.push(buildMediaFilter(filters.media.exclude));
  }

  for (const { key, field, expand } of TERMS_FILTERS) {
    const values = filters[key] as string[] | undefined;
    if (!values || values.length === 0) continue;

    filter.push({ terms: { [field]: expand ? expand(values) : values } });
  }

  return { filter, must_not };
}
