import type { estypes } from '@elastic/elasticsearch';
import type { SearchFiltersOutput } from 'generated/outputTypes';
import type { ResolvedMediaFilterItem, ResolvedSearchFilters } from '@app/controllers/searchFilters';

/** Declare filter-to-field mappings as data, keeping clause order deterministic; cache keys come from request
 * values, not this registry. */

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

/** Check numeric bounds against `undefined`, not truthiness, because zero is a meaningful range endpoint. */
function buildRangeClause(field: string, range: NumericRange): estypes.QueryDslQueryContainer | null {
  if (range?.min === undefined && range?.max === undefined) return null;

  const bounds: { gte?: number; lte?: number } = {};
  if (range?.min !== undefined) bounds.gte = range.min;
  if (range?.max !== undefined) bounds.lte = range.max;

  return { range: { [field]: bounds } };
}

/** Keyword terms are case-sensitive bytes; emit both cases because indexed content contains both spellings. */
export function expandContentRatingTerms(contentRating: string[]): string[] {
  const values = new Set<string>();
  for (const rating of contentRating) {
    values.add(rating.toUpperCase());
    values.add(rating.toLowerCase());
  }
  return [...values];
}

/** This builder requires resolved internal `mediaId`s; an unresolved wire filter would silently query `mediaId:
 * undefined`. */
function buildMediaFilter(items: readonly ResolvedMediaFilterItem[]): estypes.QueryDslQueryContainer {
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

/** Build all segment filters from resolved media ids; return the shared `filter`/`must_not` clauses used by every
 * search. */
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
