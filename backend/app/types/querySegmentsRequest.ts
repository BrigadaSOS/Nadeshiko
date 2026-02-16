import type { estypes } from '@elastic/elasticsearch';
type FieldValue = estypes.FieldValue;

export interface QuerySegmentsRequest {
  readonly query?: string;
  readonly uuid?: string;
  readonly lengthSortOrder: string;
  readonly minLength?: number;
  readonly maxLength?: number;
  readonly randomSeed?: number;
  readonly limit: number;
  readonly status: string[];
  readonly cursor?: FieldValue[];
  readonly exactMatch?: boolean;
  readonly mediaId?: number;
  readonly episode?: number[];
  readonly category?: string[]; // "ANIME", "JDRAMA"
  readonly media?: QuerySegmentsMediaFilter[];
  readonly excludedMediaIds?: number[];
}

export interface QuerySegmentsMediaFilter {
  readonly mediaId: number;
  readonly episodes: number[];
}
