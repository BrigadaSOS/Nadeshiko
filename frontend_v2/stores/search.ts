export type ResponseV1 = {
  statistics: Statistic[];
  categoryStatistics: CategoryStatistic[];
  sentences: Sentence[];
  cursor: number[];
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
}

export type SegmentInfo = {
  status: number;
  uid: string;
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


export const useApiSearch = defineStore("search", {
  actions: {
    async getRecentMedia() {
      const config = useRuntimeConfig();
      const data = await $fetch(
        `${config.public.baseURLBackend}search/media/info`,
        {
          method: "GET",
          params: { size: "10", sorted: true },
          mode: "cors",
          headers: {
            "Content-Type": "application/json",
          },
          credentials: "include"
        }
      );
      return data;
    },
    async getSentenceV1(body: any): Promise<ResponseV1> {
      const config = useRuntimeConfig();
      const data = await $fetch(
        `${config.public.baseURLBackend}search/media/sentence`,
        {
          method: "POST",
          mode: "cors",
          headers: {
            "Content-Type": "application/json",
          },
          body: {
            query: body.query,                         // Text or sentence to search 
            limit: body.limit,                         // Max amount of entries by response
            uuid: body.uuid,                           // Unique ID from sentence (Useful to get a specific sentence)
            category: body.category,                   // Anime, Liveaction
            anime_id: body.anime_id,                   // Unique ID from media
            season: body.season,                       // Array of seasons to get
            episode: body.episode,                     // Array of episodes to get
            random_seed: body.random_seed,             // A value from 0 to 1 
            content_sort: body.content_sort,           // Order by amount of characters (ASC, DESC)
            cursor: body.cursor,                       // Current page of search  
            extra: body.extra                          // Stats information 
          }
        }
      );
      // @ts-ignore 
      // we should return a ResponseV1 object
      return data;
    },
    async getMultipleSearch(body: any) {
      const config = useRuntimeConfig();
      const data = await $fetch(
        `${config.public.baseURLBackend}search/media/match/words`,
        {
          method: "POST",
          mode: "cors",
          headers: {
            "Content-Type": "application/json",
          },
          body: {
            words: body.words,
          }
        }
      );
      return data;
    },
    async getContextSentence(body: any) {
      const config = useRuntimeConfig();
      const data = await $fetch(
        `${config.public.baseURLBackend}search/media/context`,
        {
          method: "POST",
          mode: "cors",
          headers: {
            "Content-Type": "application/json",
          },
          body: {
            media_id: body.media_id,
            season: body.season,
            episode: body.episode,
            segment_position: body.segment_position,
            limit: body.limit
          }
        }
      );
      return data;
    },
  },
});
