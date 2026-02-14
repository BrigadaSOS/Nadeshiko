import { QuerySegmentsRequest } from './querySegmentsRequest';

export type QuerySearchStatsRequest = {
  readonly query?: string;
  readonly category?: QuerySegmentsRequest['category'];
  readonly exactMatch?: boolean;
  readonly minLength?: number;
  readonly maxLength?: number;
  readonly excludedMediaIds?: number[];
  readonly mediaIds?: number[];
  readonly status: string[];
};
