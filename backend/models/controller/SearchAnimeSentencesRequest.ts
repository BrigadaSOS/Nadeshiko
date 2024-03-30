import {SortOrder} from "@elastic/elasticsearch/lib/api/types";
import {SegmentStatus} from "../media/segment";

export interface SearchAnimeSentencesRequest {
    // String query including the keyword to search
    readonly query?: string;
    // Specific uuid of a segment to search
    readonly uuid?: string;
    // Max number of segments to return
    readonly limit?: number;
    // Specific anime_id to return results from
    readonly anime_id?: number;
    // Sorting mode for the response. Valid values: [asc, desc, random]
    readonly content_sort?: SortOrder;
    // Sorting mode for the response. Valid values: [asc, desc, random]
    readonly random_seed?: number;
    // Return an exact match for the segment
    readonly exact_match?: boolean;
    // List of segment status to include
    readonly status?: SegmentStatus[];
    // Previous cursor to use when doing paginated searches. Pass this value as it was returned from the previous
    // query, without making any changes
    readonly cursor?: any[];
    // List of seasons to include
    readonly season?: any[];
    // List of episodes to include
    readonly episode?: any[];
    // Filter by specific category
    readonly category?: any[];
    // Filter by specific media
    readonly media: QuerySegmentsAnimeFilter[];
}

export interface QuerySegmentsAnimeFilter {
    readonly media_id: string;
    readonly seasons: QuerySegmentsSeasonFilter[];
}

export interface QuerySegmentsSeasonFilter {
    readonly season: number;
    readonly episodes: number[];
}
