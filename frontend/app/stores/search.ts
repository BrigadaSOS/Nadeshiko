export type ResponseV1 = {
  statistics: Statistic[];
  categoryStatistics: CategoryStatistic[];
  sentences: Sentence[];
  cursor: number[];
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

export type CategoryStatistic = {
  category: number;
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
  category: number;
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
  category: number;
  nameAnimeRomaji: string;
  nameAnimeEn: string;
  nameAnimeJp: string;
  amountSentencesFound: number;
  seasonWithEpisodeHits: SeasonWithEpisodeHits;
};

export type SeasonWithEpisodeHits = {
  '1': { [key: string]: number };
};

export interface MediaInfoStats {
  readonly totalAnimes: number;
  readonly totalSegments: number;
  readonly fullTotalAnimes: number;
  readonly fullTotalSegments: number;
}

export interface MediaInfoData {
  id: number;
  category: number;
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
  numSeasons: number;
  numEpisodes: number;
}

type SentenceRequest = {
  query?: string;
  limit?: number;
  uuid?: string;
  category?: number;
  animeId?: number;
  episode?: number;
  randomSeed?: number;
  contentSort?: string;
  cursor?: number[];
  extra?: unknown;
  excludedAnimeIds?: number[];
  minLength?: number;
  maxLength?: number;
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
      return await $fetch<ResponseV2>('/internal-api/search/media/info', {
        method: 'GET',
        params: {
          size: params.size,
          query: params.query || '',
          cursor: params.cursor || 0,
          ...(params.type && { type: params.type }),
        },
      });
    },
    async getSentenceV1(body: SentenceRequest): Promise<ResponseV1> {
      return await $fetch<ResponseV1>('/internal-api/search/media/sentence', {
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
          extra: body.extra,
          excludedAnimeIds: body.excludedAnimeIds,
          minLength: body.minLength,
          maxLength: body.maxLength,
        },
      });
    },
    async getMultipleSearch(body: MultiSearchRequest) {
      return await $fetch('/internal-api/search/media/match/words', {
        method: 'POST',
        body: {
          words: body.words,
        },
      });
    },
    async getContextSentence(body: ContextSentenceRequest): Promise<ContextResponse> {
      return await $fetch<ContextResponse>('/internal-api/search/media/context', {
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
