import type { QueryFilters } from './querySegmentsRequest';

export type QuerySearchStatsRequest = {
  readonly query?: {
    readonly search?: string;
    readonly exactMatch?: boolean;
  };
  readonly filters: QueryFilters;
};
