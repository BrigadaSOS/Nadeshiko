import {MediaInfoData, MediaInfoStats, Pagination} from "../external/queryMediaInfoResponse";

export interface GetAllAnimesResponse {
    readonly stats: MediaInfoStats;
    readonly results: MediaInfoData[];
    readonly pagination: Pagination;
}
