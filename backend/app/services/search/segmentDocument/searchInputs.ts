import { ALL_CATEGORIES } from '@app/models';
import { InvalidRequestError } from '@app/errors';
import type { ResolvedSearchFilters } from '@app/controllers/searchFilters';
import type { SearchFiltersOutput, SearchRequestOutput, SearchStatsRequestOutput } from 'generated/outputTypes';

/**
 * The request shapes every segment search shares, and the checks each one runs
 * before building a query.
 *
 * Search and search-stats used to open with the same two steps written out twice:
 * default the filters, then reject an inverted length range. They are the same
 * rules, so they live here once.
 */

/**
 * Filters as the query builder needs them: media entries carrying the internal
 * `mediaId` that `resolveMediaFilterIds` puts there. Threaded through the request
 * types so a caller that skips resolution is a compile error rather than a search
 * that silently matches nothing.
 */
export type ResolvedFilters = ResolvedSearchFilters<SearchFiltersOutput>;

export type SearchRequestInput = Omit<SearchRequestOutput, 'include' | 'filters'> & {
  include?: SearchRequestOutput['include'];
  filters?: ResolvedFilters;
};

export type SearchStatsRequestInput = Omit<SearchStatsRequestOutput, 'include' | 'filters'> & {
  include?: SearchStatsRequestOutput['include'];
  filters?: ResolvedFilters;
};

/** What an unfiltered request searches: live segments across every category. */
const DEFAULT_FILTERS: ResolvedFilters = {
  status: ['ACTIVE'],
  category: ALL_CATEGORIES,
};

/**
 * The filters to search with, defaulted and validated.
 *
 * An inverted range is rejected rather than passed to Elasticsearch, which would
 * answer it with zero hits and no explanation of why.
 */
export function resolveSearchFilters(filters?: ResolvedFilters): ResolvedFilters {
  const resolved = filters ?? DEFAULT_FILTERS;

  const length = resolved.segmentLengthChars;
  if (length?.min !== undefined && length?.max !== undefined && length.min > length.max) {
    throw new InvalidRequestError('segmentLengthChars.min cannot be greater than segmentLengthChars.max');
  }

  return resolved;
}
