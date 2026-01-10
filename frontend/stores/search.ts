export type ResponseV1 = {
  statistics: Statistic[];
  categoryStatistics: CategoryStatistic[];
  sentences: Sentence[];
  cursor: number[];
}

export type ResponseV2 = {
  readonly stats: MediaInfoStats;
  readonly results: MediaInfoData[];
  readonly cursor: number | null;
  readonly hasMoreResults: boolean; 
}

export type ContextResponse = {
  sentences: Sentence[];
}

export type CategoryStatistic = {
  category: number;
  count: number;
}

export type Sentence = {
  basic_info: BasicInfo;
  segment_info: SegmentInfo;
  media_info: MediaInfo;
}

export type BasicInfo = {
  id_anime: number;
  name_anime_romaji: string;
  name_anime_en: string;
  name_anime_jp: string;
  cover: string;
  banner: string;
  episode: number;
  season: number;
  category: number;
}

export type MediaInfo = {
  path_image: string;
  path_audio: string;
  path_video: string;

  // Used when concatenated audios
  // It will always be null in api responses
  blob_audio: Blob | null;
  blob_audio_url: string | null;
}

export type SegmentInfo = {
  status: number;
  uuid: string;
  position: number;
  start_time: string;
  end_time: string;
  content_jp: string;
  content_jp_highlight: string;
  content_en: string;
  content_en_highlight: string;
  content_en_mt: boolean;
  content_es: string;
  content_es_highlight: string;
  content_es_mt: boolean;
  is_nsfw: boolean;
  actor_ja: string;
  actor_en: string;
  actor_es: string;
}

export type Statistic = {
  anime_id: number;
  category: number;
  name_anime_romaji: string;
  name_anime_en: string;
  name_anime_jp: string;
  amount_sentences_found: number;
  season_with_episode_hits: SeasonWithEpisodeHits;
}

export type SeasonWithEpisodeHits = {
  "1": { [key: string]: number };
}

export interface MediaInfoStats {
  readonly total_animes: number;
  readonly total_segments: number;
  readonly full_total_animes: number;
  readonly full_total_segments: number;
}

export interface MediaInfoData {
  id: number,
  category: number,
  created_at: string,
  updated_at?: number,
  romaji_name: string,
  english_name: string,
  japanese_name: string,
  airing_format: string,
  airing_status: string,
  release_date: Date,
  folder_media_name: string,
  genres: string[],
  cover: string,
  banner: string,
  version: string,
  num_segments: number,
  num_seasons: number,
  num_episodes: number
}

export const useApiSearch = defineStore("search", {
  actions: {
    async getRecentMedia(params: { size?: number; query?: string; cursor?: number; type?: string }): Promise<ResponseV2> {
      return await $fetch<ResponseV2>('/api/search/media/info', {
        method: 'GET',
        params: {
          size: params.size,
          sorted: true,
          query: params.query || '',
          cursor: params.cursor || 0,
          ...(params.type && { type: params.type }),
        },
      });
    },
    async getSentenceV1(body: any): Promise<ResponseV1> {
      return await $fetch<ResponseV1>('/api/search/media/sentence', {
        method: 'POST',
        body: {
          query: body.query,
          limit: body.limit,
          uuid: body.uuid,
          category: body.category,
          anime_id: body.anime_id,
          season: body.season,
          episode: body.episode,
          random_seed: body.random_seed,
          content_sort: body.content_sort,
          cursor: body.cursor,
          extra: body.extra,
          excluded_anime_ids: body.excluded_anime_ids,
          min_length: body.min_length,
          max_length: body.max_length,
        },
      });
    },
    async getMultipleSearch(body: any) {
      return await $fetch('/api/search/media/match/words', {
        method: 'POST',
        body: {
          words: body.words,
        },
      });
    },
    async getContextSentence(body: any): Promise<ContextResponse> {
      return await $fetch<ContextResponse>('/api/search/media/context', {
        method: 'POST',
        body: {
          media_id: body.media_id,
          season: body.season,
          episode: body.episode,
          segment_position: body.segment_position,
          limit: body.limit,
        },
      });
    },
  },
});
