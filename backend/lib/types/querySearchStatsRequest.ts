import { SegmentStatus } from '@app/entities';
import { QuerySegmentsRequest } from './querySegmentsRequest';

export type QuerySearchStatsRequest = {
  readonly query?: string;
  readonly category?: QuerySegmentsRequest['category'];
  readonly exactMatch?: boolean;
  readonly minLength?: number;
  readonly maxLength?: number;
  readonly excludedAnimeIds?: number[];
  readonly status: SegmentStatus[];
};
