import type { estypes } from '@elastic/elasticsearch';

export interface QuerySegmentsRequest {
  readonly query?: {
    readonly search?: string;
    readonly exactMatch?: boolean;
  };
  readonly sort?: {
    readonly mode?: string;
    readonly seed?: number;
  };
  readonly limit: number;
  readonly cursor?: string;
  readonly filters: QueryFilters;
}

export interface QueryFilters {
  readonly media?: {
    readonly include?: MediaFilterItem[];
    readonly exclude?: MediaFilterItem[];
  };
  readonly category?: string[];
  readonly contentRating?: string[];
  readonly status: string[];
  readonly segmentLengthChars?: { readonly min?: number; readonly max?: number };
  readonly segmentDurationMs?: { readonly min?: number; readonly max?: number };
  readonly languages?: {
    readonly exclude?: string[];
  };
}

export interface MediaFilterItem {
  readonly mediaId: number;
  readonly episodes?: number[];
}
