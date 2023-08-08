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
    readonly content_sort?: string;
    // Random seed to use when random sorting
    readonly random_seed?: string;
    // Previous cursor to use when doing paginated searches. Pass this value as it was returned from the previous
    // query, without making any changes
    readonly cursor?: any[];
}