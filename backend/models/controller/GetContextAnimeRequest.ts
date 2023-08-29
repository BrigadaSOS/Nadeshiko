export interface GetContextAnimeRequest {
    readonly media_id: number;
    readonly season: number;
    readonly episode: number;
    readonly segment_position: number;
    readonly limit?: number;
}