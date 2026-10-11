import { ALL_CATEGORIES } from '@app/models';
import { InvalidRequestError } from '@app/errors';
import type { ResolvedSearchFilters } from '@app/controllers/searchFilters';
import type { SearchFiltersOutput, SearchRequestOutput, SearchStatsRequestOutput } from 'generated/outputTypes';

/** Share request defaults and inverted-range validation between search and stats so the two entry points cannot
 * drift. */

/** Pass only filters resolved to internal media ids; the type boundary prevents a caller from silently matching
 * nothing. */
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

/** Reject inverted ranges before Elasticsearch; returning zero hits would hide the input error from the caller. */
export function resolveSearchFilters(filters?: ResolvedFilters): ResolvedFilters {
  const resolved = filters ?? DEFAULT_FILTERS;

  const length = resolved.segmentLengthChars;
  if (length?.min !== undefined && length?.max !== undefined && length.min > length.max) {
    throw new InvalidRequestError('segmentLengthChars.min cannot be greater than segmentLengthChars.max');
  }

  return resolved;
}
