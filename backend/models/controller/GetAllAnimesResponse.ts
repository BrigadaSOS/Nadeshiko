import { MediaInfoData, MediaInfoStats } from '../external/queryMediaInfoResponse';

export interface GetAllAnimesResponse {
  readonly stats: MediaInfoStats;
  readonly results: MediaInfoData[];
  readonly cursor: number | null;
  readonly hasMoreResults: boolean;
}
