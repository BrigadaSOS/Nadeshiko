import {MediaInfoData, MediaInfoStats, QueryMediaInfoResponse} from "../external/queryMediaInfoResponse";

export interface GetAllAnimesResponse {
    readonly stats: MediaInfoStats;
    readonly results: MediaInfoData[];
}
