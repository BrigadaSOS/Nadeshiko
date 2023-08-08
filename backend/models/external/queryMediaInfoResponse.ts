export interface QueryMediaInfoResponse {
    readonly stats: MediaInfoStats;
    readonly results: {[key: number]: MediaInfoData};
}

export interface MediaInfoStats {
    readonly total_animes: number;
    readonly total_segments: number;
}

export interface MediaInfoData {
    media_id: number,
    created_at: string,
    updated_at?: number,
    romaji_name: string,
    english_name: string,
    japanese_name: string,
    airing_format: string,
    airing_status: string,
    folder_media_name: string,
    genres: string[],
    cover: string,
    banner: string,
    version: string,
    num_segments: number,
    num_seasons: number,
    num_episodes: number
}