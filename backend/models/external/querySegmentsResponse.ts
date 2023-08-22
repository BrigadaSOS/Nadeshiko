import {FieldValue} from "@elastic/elasticsearch/lib/api/types";


export interface QuerySegmentsResponse {
    statistics: SearchAnimeSentencesStatistics[];
    sentences: SearchAnimeSentencesSegment[];
    cursor?: FieldValue[];
}

export interface SearchAnimeSentencesSegment {
    basic_info: BasicInfoData;
    segment_info: SegmentInfoData;
    media_info: MediaInfoData;
}

export interface SearchAnimeSentencesStatistics {
    anime_id: number;
    name_anime_en: string;
    name_anime_jp: string;
    amount_sentences_found: number;
}

interface BasicInfoData {
    id_anime: number;
    name_anime_en: string;
    name_anime_jp?: string;
    cover: string;
    banner: string;
    season: number;
    episode: number;
}

interface SegmentInfoData {
    status: number;
    uuid: string;
    position: number;
    start_time: string;
    end_time: string;
    content_jp: string;
    content_jp_highlight?: string;
    content_en?: string;
    content_en_highlight?: string;
    content_en_mt: boolean;
    content_es?: string;
    content_es_highlight?: string;
    content_es_mt: boolean;
    is_nsfw: boolean;
    segment_info: boolean;
    actor_ja?: string;
    actor_es?: string;
    actor_en?: string;
}

interface MediaInfoData {
    path_image: string;
    path_audio: string;
    path_video: string;
}