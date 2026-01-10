import { estypes } from '@elastic/elasticsearch';
type FieldValue = estypes.FieldValue;
import { SegmentStatus } from '@app/entities';

export interface QuerySegmentsRequest {
  readonly query?: string;
  readonly uuid?: string;
  readonly length_sort_order: string;
  readonly min_length?: number;
  readonly max_length?: number;
  readonly random_seed?: number;
  readonly limit: number;
  readonly status: SegmentStatus[];
  readonly cursor?: FieldValue[];
  readonly exact_match?: boolean;
  readonly anime_id?: number; // To be deprecated
  readonly season?: any[];
  readonly episode?: any[];
  readonly category?: any[];
  readonly media?: QuerySegmentsAnimeFilter[];
  readonly extra?: boolean;
  readonly excluded_anime_ids?: number[];
}

export interface QuerySegmentsAnimeFilter {
  readonly media_id: string;
  readonly seasons: QuerySegmentsSeasonFilter[];
}

export interface QuerySegmentsSeasonFilter {
  readonly season: number;
  readonly episodes: number[];
}
