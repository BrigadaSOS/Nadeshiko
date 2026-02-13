export type SearchCategory = 'ANIME' | 'JDRAMA';

export type SentenceSearchResponse = {
  sentences?: Sentence[];
  cursor?: number[] | null;
  queryStats?: QueryStats;
};

export type SearchStatsResponse = {
  mediaStatistics?: Statistic[];
  categoryStatistics?: CategoryStatistic[];
};

export type ResponseV2 = {
  readonly stats: MediaInfoStats;
  readonly results: MediaInfoData[];
  readonly cursor: number | null;
  readonly hasMoreResults: boolean;
};

export type ContextResponse = {
  sentences: Sentence[];
};

export type QueryStats = {
  returnedCount: number;
  hasMoreResults: boolean;
  estimatedTotalHits: number;
  estimatedTotalHitsRelation: 'eq' | 'gte';
};

export type CategoryStatistic = {
  category: SearchCategory;
  count: number;
};

export type Sentence = {
  basicInfo: BasicInfo;
  segmentInfo: SegmentInfo;
  mediaInfo: MediaInfo;
};

export type BasicInfo = {
  animeId: number;
  nameAnimeRomaji: string;
  nameAnimeEn: string;
  nameAnimeJp: string;
  cover: string;
  banner: string;
  episode: number;
  category: SearchCategory;
};

export type MediaInfo = {
  pathImage: string;
  pathAudio: string;
  pathVideo: string;

  // Used when concatenated audios
  // It will always be null in api responses
  blobAudio: Blob | null;
  blobAudioUrl: string | null;
};

export type SegmentInfo = {
  status: number;
  uuid: string;
  position: number;
  startTime: string;
  endTime: string;
  contentJp: string;
  contentJpHighlight: string;
  contentEn: string;
  contentEnHighlight: string;
  contentEnMt: boolean;
  contentEs: string;
  contentEsHighlight: string;
  contentEsMt: boolean;
  isNsfw: boolean;
  actorJa: string;
  actorEn: string;
  actorEs: string;
};

export type Statistic = {
  animeId: number;
  category: SearchCategory;
  nameAnimeRomaji: string;
  nameAnimeEn: string;
  nameAnimeJp: string;
  amountSentencesFound: number;
  episodeHits: EpisodeHits;
};

export type EpisodeHits = Record<string, number>;

export interface MediaInfoStats {
  readonly totalAnimes: number;
  readonly totalSegments: number;
  readonly fullTotalAnimes: number;
  readonly fullTotalSegments: number;
}

export interface MediaInfoData {
  id: number;
  category: SearchCategory;
  anilistId: number;
  createdAt: string;
  updatedAt?: number;
  romajiName: string;
  englishName: string;
  japaneseName: string;
  airingFormat: string;
  airingStatus: string;
  startDate: string;
  endDate: string;
  folderMediaName: string;
  genres: string[];
  cover: string;
  banner: string;
  version: string;
  numSegments: number;
  numEpisodes: number;
}

type SentenceRequest = {
  query?: string;
  limit?: number;
  uuid?: string;
  category?: SearchCategory[];
  animeId?: number;
  episode?: number[];
  randomSeed?: number;
  contentSort?: string;
  cursor?: number[];
  excludedAnimeIds?: number[];
  minLength?: number;
  maxLength?: number;
  exactMatch?: boolean;
  status?: number[];
  media?: Array<{ mediaId: number; episodes: number[] }>;
};

type SearchStatsRequest = {
  query?: string;
  category?: SearchCategory[];
  exactMatch?: boolean;
  minLength?: number;
  maxLength?: number;
  excludedAnimeIds?: number[];
  status?: number[];
};

type MultiSearchRequest = {
  words: string[];
};

type ContextSentenceRequest = {
  mediaId: number;
  episode: number;
  segmentPosition: number;
  limit: number;
};

export const useApiSearch = defineStore('search', {
  actions: {
    async getRecentMedia(params: {
      size?: number;
      query?: string;
      cursor?: number;
      type?: string;
    }): Promise<ResponseV2> {
      return await $fetch<ResponseV2>('/api/search/media', {
        method: 'GET',
        params: {
          size: params.size,
          query: params.query || '',
          cursor: params.cursor || 0,
          ...(params.type && { type: params.type }),
        },
      });
    },
    async getSentenceV1(body: SentenceRequest): Promise<SentenceSearchResponse> {
      return await $fetch<SentenceSearchResponse>('/api/search/sentence', {
        method: 'POST',
        body: {
          query: body.query,
          limit: body.limit,
          uuid: body.uuid,
          category: body.category,
          animeId: body.animeId,
          episode: body.episode,
          randomSeed: body.randomSeed,
          contentSort: body.contentSort,
          cursor: body.cursor,
          excludedAnimeIds: body.excludedAnimeIds,
          minLength: body.minLength,
          maxLength: body.maxLength,
          exactMatch: body.exactMatch,
          status: body.status,
          media: body.media,
        },
      });
    },
    async getSearchStatsV1(body: SearchStatsRequest): Promise<SearchStatsResponse> {
      return await $fetch<SearchStatsResponse>('/api/search/stats', {
        method: 'POST',
        body: {
          query: body.query,
          category: body.category,
          exactMatch: body.exactMatch,
          minLength: body.minLength,
          maxLength: body.maxLength,
          excludedAnimeIds: body.excludedAnimeIds,
          status: body.status,
        },
      });
    },
    async getMultipleSearch(body: MultiSearchRequest) {
      return await $fetch('/api/search/match-words', {
        method: 'POST',
        body: {
          words: body.words,
        },
      });
    },
    async getContextSentence(body: ContextSentenceRequest): Promise<ContextResponse> {
      return await $fetch<ContextResponse>('/api/search/context', {
        method: 'POST',
        body: {
          mediaId: body.mediaId,
          episode: body.episode,
          segmentPosition: body.segmentPosition,
          limit: body.limit,
        },
      });
    },
  },
});
