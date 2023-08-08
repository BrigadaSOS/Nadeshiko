export interface QueryWordsMatchedResponse {
    readonly results: WordMatch[];
}

export interface WordMatch {
    readonly word: string;
    readonly is_match: boolean;
    readonly total_matches: number;
    readonly media: any;
}

export interface WordMatchMediaInfo {
    readonly media_id: number;
    readonly english_name: string;
    readonly japanese_name: string;
    readonly romaji_name: string;
    readonly matches: number;
}
