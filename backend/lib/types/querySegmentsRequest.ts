import type * as estypes from '@elastic/elasticsearch/lib/api/types';
type FieldValue = estypes.FieldValue;
import { SegmentStatus } from '@app/entities';

export interface QuerySegmentsRequest {
  readonly query?: string;
  readonly uuid?: string;
  readonly lengthSortOrder: string;
  readonly minLength?: number;
  readonly maxLength?: number;
  readonly randomSeed?: number;
  readonly limit: number;
  readonly status: SegmentStatus[];
  readonly cursor?: FieldValue[];
  readonly exactMatch?: boolean;
  readonly animeId?: number; // To be deprecated
  readonly episode?: number[];
  readonly category?: string[]; // "ANIME", "JDRAMA"
  readonly media?: QuerySegmentsAnimeFilter[];
  readonly extra?: boolean;
  readonly excludedAnimeIds?: number[];
}

export interface QuerySegmentsAnimeFilter {
  readonly mediaId: number;
  readonly episodes: number[];
}
