export type SearchCategory = 'ANIME' | 'JDRAMA';

export type SearchResponse = {
  results?: SearchResult[];
  pagination?: PaginationInfo;
};

export type SearchStatsResponse = {
  media?: MediaSearchStats[];
  categories?: CategoryCount[];
};

export type MediaBrowseResponse = {
  readonly data: MediaSummary[];
  readonly cursor?: number;
  readonly hasMore: boolean;
};

export type SegmentContextResponse = {
  segments: SearchResult[];
};

// Raw API response types (before resolving includes)
type RawSearchResult = {
  segment: SearchResultSegment & { mediaId: number };
  urls: SearchResultUrls;
};

type Includes = {
  media?: Record<string, SearchResultMedia>;
};

type RawSearchResponse = {
  segments?: RawSearchResult[];
  includes?: Includes;
  pagination?: PaginationInfo;
};

type RawSegmentContextResponse = {
  segments: RawSearchResult[];
  includes?: Includes;
};

function resolveIncludes(response: RawSearchResponse): SearchResponse {
  const mediaMap = response.includes?.media ?? {};
  return {
    results: response.segments?.map((r) => ({
      media: mediaMap[String(r.segment.mediaId)] ?? ({} as SearchResultMedia),
      segment: r.segment,
      urls: r.urls,
    })),
    pagination: response.pagination,
  };
}

function resolveContextIncludes(response: RawSegmentContextResponse): SegmentContextResponse {
  const mediaMap = response.includes?.media ?? {};
  return {
    segments: response.segments.map((r) => ({
      media: mediaMap[String(r.segment.mediaId)] ?? ({} as SearchResultMedia),
      segment: r.segment,
      urls: r.urls,
    })),
  };
}

export type PaginationInfo = {
  hasMore: boolean;
  estimatedTotalHits: number;
  estimatedTotalHitsRelation: 'EXACT' | 'LOWER_BOUND';
  cursor?: number[];
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
  startTimeMs: number;
  endTimeMs: number;
  episode: number;
  textJa: { content: string; highlight?: string };
  textEn: { content?: string; highlight?: string; isMachineTranslated: boolean };
  textEs: { content?: string; highlight?: string; isMachineTranslated: boolean };
  contentRating: string;
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

export interface ExternalIds {
  anilist?: string;
  imdb?: string;
  tvdb?: string;
}

export interface MediaSummary {
  id: number;
  category: SearchCategory;
  externalIds?: ExternalIds;
  nameRomaji: string;
  nameEn: string;
  nameJa: string;
  airingFormat: string;
  airingStatus: string;
  startDate: string;
  endDate?: string | null;
  genres: string[];
  coverUrl: string;
  bannerUrl: string;
  segmentCount?: number;
  episodeCount?: number;
  seasonName: string;
  seasonYear: number;
  studio: string;
}

export type MediaFilterItem = {
  mediaId: number;
  episodes?: number[];
};

export type SearchFilters = {
  media?: {
    include?: MediaFilterItem[];
    exclude?: MediaFilterItem[];
  };
  category?: SearchCategory[];
  contentRating?: string[];
  status?: string[];
  segmentLength?: { min?: number; max?: number };
  segmentDurationMs?: { min?: number; max?: number };
};

type SearchRequest = {
  query?: string;
  limit?: number;
  uuid?: string;
  exactMatch?: boolean;
  sort?: string;
  cursor?: number[];
  randomSeed?: number;
  filters?: SearchFilters;
};

type SearchStatsRequest = {
  query?: string;
  exactMatch?: boolean;
  filters?: SearchFilters;
};

type MultiSearchRequest = {
  words: string[];
};

type SegmentContextRequest = {
  uuid: string;
  limit?: number;
  contentRating?: string[];
};

export const useApiSearch = defineStore('search', {
  actions: {
    async getRecentMedia(params: {
      limit?: number;
      query?: string;
      cursor?: number;
      category?: string;
    }): Promise<MediaBrowseResponse> {
      return await $fetch<MediaBrowseResponse>('/api/media/browse', {
        method: 'GET',
        params: {
          limit: params.limit,
          query: params.query || '',
          cursor: params.cursor || 0,
          ...(params.category && { category: params.category }),
        },
      });
    },
    async searchSegments(body: SearchRequest): Promise<SearchResponse> {
      const raw = await $fetch<RawSearchResponse>('/api/search/segments', {
        method: 'POST',
        body: {
          query: body.query,
          limit: body.limit,
          uuid: body.uuid,
          exactMatch: body.exactMatch,
          sort: body.sort,
          cursor: body.cursor,
          randomSeed: body.randomSeed,
          filters: body.filters,
        },
      });
      return resolveIncludes(raw);
    },
    async getSearchStats(body: SearchStatsRequest): Promise<SearchStatsResponse> {
      return await $fetch<SearchStatsResponse>('/api/search/stats', {
        method: 'POST',
        body: {
          query: body.query,
          exactMatch: body.exactMatch,
          filters: body.filters,
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
    async getSegmentContext(params: SegmentContextRequest): Promise<SegmentContextResponse> {
      const raw = await $fetch<RawSegmentContextResponse>(`/api/search/context/${params.uuid}`, {
        method: 'GET',
        params: {
          limit: params.limit,
          contentRating: params.contentRating?.join(',') || undefined,
        },
      });
      return resolveContextIncludes(raw);
    },
  },
});
