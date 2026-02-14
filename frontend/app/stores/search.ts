export type SearchCategory = 'ANIME' | 'JDRAMA';

export type SearchResponse = {
  results?: SearchResult[];
  cursor?: number[] | null;
  pagination?: PaginationInfo;
};

export type SearchStatsResponse = {
  media?: MediaSearchStats[];
  categories?: CategoryCount[];
};

export type MediaBrowseResponse = {
  readonly stats: MediaBrowseStats;
  readonly results: MediaSummary[];
  readonly cursor: number | null;
  readonly hasMore: boolean;
};

export type SegmentContextResponse = {
  segments: SearchResult[];
};

export type PaginationInfo = {
  pageSize: number;
  hasMore: boolean;
  estimatedTotalHits: number;
  estimatedTotalHitsRelation: 'EXACT' | 'LOWER_BOUND';
};

export type CategoryCount = {
  category: SearchCategory;
  count: number;
};

export type SearchResult = {
  media: SearchResultMedia;
  segment: SearchResultSegment;
  urls: SearchResultUrls;
};

export type SearchResultMedia = {
  mediaId: number;
  nameRomaji: string;
  nameEn: string;
  nameJa: string;
  coverUrl: string;
  bannerUrl: string;
  category: SearchCategory;
};

export type SearchResultUrls = {
  imageUrl: string;
  audioUrl: string;
  videoUrl: string;

  // Used when concatenated audios
  // It will always be null in api responses
  blobAudio: Blob | null;
  blobAudioUrl: string | null;
};

export type SearchResultSegment = {
  status: string;
  uuid: string;
  position: number;
  startTime: string;
  endTime: string;
  episodeNumber: number;
  ja: { content: string; highlight?: string };
  en: { content?: string; highlight?: string; isMachineTranslated: boolean };
  es: { content?: string; highlight?: string; isMachineTranslated: boolean };
  isNsfw: boolean;
};

export type MediaSearchStats = {
  mediaId: number;
  category: SearchCategory;
  nameRomaji: string;
  nameEn: string;
  nameJa: string;
  segmentCount: number;
  episodeHits: EpisodeHits;
};

export type EpisodeHits = Record<string, number>;

export interface MediaBrowseStats {
  readonly filteredMediaCount: number;
  readonly filteredSegmentCount: number;
  readonly totalMediaCount: number;
  readonly totalSegmentCount: number;
}

export interface MediaSummary {
  id: number;
  category: SearchCategory;
  anilistId: number;
  createdAt: string;
  updatedAt?: number;
  nameRomaji: string;
  nameEn: string;
  nameJa: string;
  airingFormat: string;
  airingStatus: string;
  startDate: string;
  endDate: string;
  folderMediaName: string;
  genres: string[];
  coverUrl: string;
  bannerUrl: string;
  version: string;
  segmentCount: number;
  episodeCount: number;
}

type SearchRequest = {
  query?: string;
  limit?: number;
  uuid?: string;
  category?: SearchCategory[];
  mediaId?: number;
  episode?: number[];
  randomSeed?: number;
  contentSort?: string;
  cursor?: number[];
  excludedMediaIds?: number[];
  minLength?: number;
  maxLength?: number;
  exactMatch?: boolean;
  status?: string[];
  media?: Array<{ mediaId: number; episodes: number[] }>;
};

type SearchStatsRequest = {
  query?: string;
  category?: SearchCategory[];
  exactMatch?: boolean;
  minLength?: number;
  maxLength?: number;
  excludedMediaIds?: number[];
  mediaIds?: number[];
  status?: string[];
};

type MultiSearchRequest = {
  words: string[];
};

type SegmentContextRequest = {
  mediaId: number;
  episodeNumber: number;
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
    }): Promise<MediaBrowseResponse> {
      return await $fetch<MediaBrowseResponse>('/api/media/browse', {
        method: 'GET',
        params: {
          size: params.size,
          query: params.query || '',
          cursor: params.cursor || 0,
          ...(params.type && { type: params.type }),
        },
      });
    },
    async searchSegments(body: SearchRequest): Promise<SearchResponse> {
      return await $fetch<SearchResponse>('/api/search/segments', {
        method: 'POST',
        body: {
          query: body.query,
          limit: body.limit,
          uuid: body.uuid,
          category: body.category,
          mediaId: body.mediaId,
          episode: body.episode,
          randomSeed: body.randomSeed,
          contentSort: body.contentSort,
          cursor: body.cursor,
          excludedMediaIds: body.excludedMediaIds,
          minLength: body.minLength,
          maxLength: body.maxLength,
          exactMatch: body.exactMatch,
          status: body.status,
          media: body.media,
        },
      });
    },
    async getSearchStats(body: SearchStatsRequest): Promise<SearchStatsResponse> {
      return await $fetch<SearchStatsResponse>('/api/search/stats', {
        method: 'POST',
        body: {
          query: body.query,
          category: body.category,
          exactMatch: body.exactMatch,
          minLength: body.minLength,
          maxLength: body.maxLength,
          excludedMediaIds: body.excludedMediaIds,
          mediaIds: body.mediaIds,
          status: body.status,
        },
      });
    },
    async searchWords(body: MultiSearchRequest) {
      return await $fetch('/api/search/words', {
        method: 'POST',
        body: {
          words: body.words,
        },
      });
    },
    async getSegmentContext(body: SegmentContextRequest): Promise<SegmentContextResponse> {
      return await $fetch<SegmentContextResponse>('/api/search/context', {
        method: 'POST',
        body: {
          mediaId: body.mediaId,
          episodeNumber: body.episodeNumber,
          segmentPosition: body.segmentPosition,
          limit: body.limit,
        },
      });
    },
  },
});
