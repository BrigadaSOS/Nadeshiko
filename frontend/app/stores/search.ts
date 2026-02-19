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
  readonly media: MediaSummary[];
  readonly cursor?: number | null;
  readonly hasMore: boolean;
  readonly data: MediaSummary[];
};

export type MediaAutocompleteResponse = {
  readonly media: MediaSummary[];
};

export type SegmentContextResponse = {
  segments: SearchResult[];
};

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
  blobAudio: Blob | null;
  blobAudioUrl: string | null;
};

export type SearchResultSegment = {
  id?: number;
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
  segmentLengthChars?: { min?: number; max?: number };
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
  include?: string[];
};

type SearchStatsRequest = {
  query?: string;
  exactMatch?: boolean;
  filters?: SearchFilters;
  include?: string[];
};

type MultiSearchRequest = {
  words: string[];
  exactMatch?: boolean;
  filters?: SearchFilters;
  include?: string[];
};

export type MultiSearchResult = {
  word: string;
  isMatch: boolean;
  totalMatches: number;
  media?: Array<{
    mediaId: number;
    totalMatches: number;
  }>;
};

export type MultiSearchResponse = {
  results: MultiSearchResult[];
};

type SegmentContextRequest = {
  uuid: string;
  limit?: number;
  contentRating?: string[];
};

type RawIncludes = {
  media?: Record<string, Record<string, unknown>>;
};

type RawSearchResponse = {
  segments?: Array<Record<string, unknown>>;
  includes?: RawIncludes;
  pagination?: PaginationInfo;
};

type RawSegmentContextResponse = {
  segments?: Array<Record<string, unknown>>;
  includes?: RawIncludes;
};

type RawSearchStatsResponse = {
  media?: Array<Record<string, unknown>>;
  categories?: Array<Record<string, unknown>>;
  includes?: RawIncludes;
};

type RawSearchWordsResponse = {
  results?: Array<Record<string, unknown>>;
  includes?: RawIncludes;
};

function toRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function toNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function normalizeCategory(value: unknown, fallback: SearchCategory = 'ANIME'): SearchCategory {
  return value === 'JDRAMA' ? 'JDRAMA' : value === 'ANIME' ? 'ANIME' : fallback;
}

function toSearchResultMedia(media: Record<string, unknown> | undefined, fallbackMediaId: number): SearchResultMedia {
  const mediaId = toNumber(media?.mediaId) ?? toNumber(media?.id) ?? fallbackMediaId;

  return {
    mediaId,
    nameRomaji: asString(media?.nameRomaji) ?? '',
    nameEn: asString(media?.nameEn) ?? '',
    nameJa: asString(media?.nameJa) ?? '',
    coverUrl: asString(media?.coverUrl) ?? '',
    bannerUrl: asString(media?.bannerUrl) ?? '',
    category: normalizeCategory(media?.category),
  };
}

function toEpisodeHits(value: unknown): EpisodeHits {
  const data = toRecord(value);
  if (!data) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(data)
      .map(([key, raw]) => [key, toNumber(raw) ?? 0] as const)
      .filter(([, count]) => Number.isFinite(count)),
  );
}

function toSearchResultSegment(segment: Record<string, unknown>): SearchResultSegment {
  const textJa = toRecord(segment.textJa);
  const textEn = toRecord(segment.textEn);
  const textEs = toRecord(segment.textEs);

  return {
    id: toNumber(segment.id),
    status: asString(segment.status) ?? 'ACTIVE',
    uuid: asString(segment.uuid) ?? '',
    position: toNumber(segment.position) ?? 0,
    startTimeMs: toNumber(segment.startTimeMs) ?? 0,
    endTimeMs: toNumber(segment.endTimeMs) ?? 0,
    episode: toNumber(segment.episode) ?? 0,
    textJa: {
      content: asString(textJa?.content) ?? '',
      highlight: asString(textJa?.highlight),
    },
    textEn: {
      content: asString(textEn?.content),
      highlight: asString(textEn?.highlight),
      isMachineTranslated: typeof textEn?.isMachineTranslated === 'boolean' ? textEn.isMachineTranslated : false,
    },
    textEs: {
      content: asString(textEs?.content),
      highlight: asString(textEs?.highlight),
      isMachineTranslated: typeof textEs?.isMachineTranslated === 'boolean' ? textEs.isMachineTranslated : false,
    },
    contentRating: asString(segment.contentRating) ?? 'SAFE',
  };
}

function toSearchResultUrls(urls: Record<string, unknown> | undefined): SearchResultUrls {
  return {
    imageUrl: asString(urls?.imageUrl) ?? '',
    audioUrl: asString(urls?.audioUrl) ?? '',
    videoUrl: asString(urls?.videoUrl) ?? '',
    blobAudio: null,
    blobAudioUrl: null,
  };
}

function resolveSearchEntry(
  entry: Record<string, unknown>,
  mediaMap: Record<string, Record<string, unknown>>,
): SearchResult | null {
  const legacySegment = toRecord(entry.segment);
  const segmentRaw = legacySegment ?? entry;
  const urlsRaw = toRecord(entry.urls) ?? toRecord(segmentRaw.urls);
  const mediaId = toNumber(segmentRaw.mediaId);

  if (mediaId === undefined) {
    return null;
  }

  return {
    media: toSearchResultMedia(mediaMap[String(mediaId)], mediaId),
    segment: toSearchResultSegment(segmentRaw),
    urls: toSearchResultUrls(urlsRaw),
  };
}

function resolveIncludes(response: RawSearchResponse): SearchResponse {
  const mediaMap = response.includes?.media ?? {};
  const results =
    response.segments
      ?.map((entry) => resolveSearchEntry(entry, mediaMap))
      .filter((entry): entry is SearchResult => entry !== null) ?? [];

  return {
    results,
    pagination: response.pagination,
  };
}

function resolveContextIncludes(response: RawSegmentContextResponse): SegmentContextResponse {
  const mediaMap = response.includes?.media ?? {};
  const segments =
    response.segments
      ?.map((entry) => resolveSearchEntry(entry, mediaMap))
      .filter((entry): entry is SearchResult => entry !== null) ?? [];

  return { segments };
}

function resolveSearchStats(response: RawSearchStatsResponse): SearchStatsResponse {
  const mediaMap = response.includes?.media ?? {};

  const media =
    response.media
      ?.map((stat) => {
        const mediaId = toNumber(stat.mediaId);
        if (mediaId === undefined) {
          return null;
        }

        const includedMedia = mediaMap[String(mediaId)];
        return {
          mediaId,
          category: normalizeCategory(stat.category ?? includedMedia?.category),
          nameRomaji: asString(stat.nameRomaji) ?? asString(includedMedia?.nameRomaji) ?? '',
          nameEn: asString(stat.nameEn) ?? asString(includedMedia?.nameEn) ?? '',
          nameJa: asString(stat.nameJa) ?? asString(includedMedia?.nameJa) ?? '',
          segmentCount: toNumber(stat.segmentCount) ?? toNumber(stat.matchCount) ?? 0,
          episodeHits: toEpisodeHits(stat.episodeHits),
        } satisfies MediaSearchStats;
      })
      .filter((item): item is MediaSearchStats => item !== null) ?? [];

  const categories =
    response.categories
      ?.map((entry) => {
        const category = entry.category;
        if (category !== 'ANIME' && category !== 'JDRAMA') {
          return null;
        }

        return {
          category,
          count: toNumber(entry.count) ?? 0,
        } satisfies CategoryCount;
      })
      .filter((item): item is CategoryCount => item !== null) ?? [];

  return { media, categories };
}

function resolveSearchWords(response: RawSearchWordsResponse): MultiSearchResponse {
  const results =
    response.results?.map((entry) => {
      const mediaRaw = Array.isArray(entry.media) ? entry.media : [];
      const media = mediaRaw
        .map((item) => {
          const mediaRecord = toRecord(item);
          const mediaId = toNumber(mediaRecord?.mediaId);
          if (mediaId === undefined) {
            return null;
          }

          return {
            mediaId,
            totalMatches: toNumber(mediaRecord?.totalMatches) ?? toNumber(mediaRecord?.matchCount) ?? 0,
          };
        })
        .filter((item): item is { mediaId: number; totalMatches: number } => item !== null);

      const totalMatches = toNumber(entry.totalMatches) ?? toNumber(entry.matchCount) ?? 0;
      const isMatch = typeof entry.isMatch === 'boolean' ? entry.isMatch : totalMatches > 0;

      return {
        word: asString(entry.word) ?? '',
        isMatch,
        totalMatches,
        media,
      } satisfies MultiSearchResult;
    }) ?? [];

  return { results };
}

function resolveMediaBrowseResponse(raw: Record<string, unknown>): MediaBrowseResponse {
  const media =
    (Array.isArray(raw.media)
      ? (raw.media as MediaSummary[])
      : Array.isArray(raw.data)
        ? (raw.data as MediaSummary[])
        : []) ?? [];
  const pagination = toRecord(raw.pagination);
  const cursor = toNumber(pagination?.cursor) ?? toNumber(raw.cursor) ?? null;
  const hasMore =
    typeof pagination?.hasMore === 'boolean'
      ? pagination.hasMore
      : typeof raw.hasMore === 'boolean'
        ? raw.hasMore
        : false;

  return {
    media,
    cursor,
    hasMore,
    data: media,
  };
}

export const useApiSearch = defineStore('search', {
  actions: {
    async getRecentMedia(params: {
      limit?: number;
      query?: string;
      cursor?: number;
      category?: string;
    }): Promise<MediaBrowseResponse> {
      const raw = await $fetch<Record<string, unknown>>('/api/media/browse', {
        method: 'GET',
        params: {
          limit: params.limit,
          query: params.query || '',
          cursor: params.cursor ?? 0,
          ...(params.category && { category: params.category }),
        },
      });

      return resolveMediaBrowseResponse(raw);
    },

    async autocompleteMedia(params: {
      query: string;
      limit?: number;
      category?: SearchCategory;
    }): Promise<MediaAutocompleteResponse> {
      const raw = await $fetch<Record<string, unknown>>('/api/media/autocomplete', {
        method: 'GET',
        params: {
          query: params.query,
          limit: params.limit,
          category: params.category,
        },
      });

      return {
        media: Array.isArray(raw.media) ? (raw.media as MediaSummary[]) : [],
      };
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
          include: body.include ?? ['media'],
        },
      });

      return resolveIncludes(raw);
    },

    async getSearchStats(body: SearchStatsRequest): Promise<SearchStatsResponse> {
      const raw = await $fetch<RawSearchStatsResponse>('/api/search/stats', {
        method: 'POST',
        body: {
          query: body.query,
          exactMatch: body.exactMatch,
          filters: body.filters,
          include: body.include ?? ['media'],
        },
      });

      return resolveSearchStats(raw);
    },

    async searchWords(body: MultiSearchRequest): Promise<MultiSearchResponse> {
      const raw = await $fetch<RawSearchWordsResponse>('/api/search/words', {
        method: 'POST',
        body: {
          words: body.words,
          exactMatch: body.exactMatch,
          filters: body.filters,
          include: body.include ?? ['media'],
        },
      });

      return resolveSearchWords(raw);
    },

    async getMultipleSearch(body: MultiSearchRequest): Promise<MultiSearchResponse> {
      return await this.searchWords(body);
    },

    async searchCollectionSegments(collectionId: number, cursor?: number): Promise<SearchResponse> {
      const raw = await $fetch<RawSearchResponse>(`/api/collections/${collectionId}/search`, {
        params: { cursor, limit: 20 },
      });

      return resolveIncludes(raw);
    },

    async getCollectionStats(collectionId: number): Promise<SearchStatsResponse> {
      const raw = await $fetch<RawSearchStatsResponse>(`/api/collections/${collectionId}/stats`);

      return resolveSearchStats(raw);
    },

    async getSegmentContext(params: SegmentContextRequest): Promise<SegmentContextResponse> {
      const raw = await $fetch<RawSegmentContextResponse>(`/api/search/context/${params.uuid}`, {
        method: 'GET',
        params: {
          limit: params.limit,
          contentRating: params.contentRating?.join(',') || undefined,
          include: 'media',
        },
      });

      return resolveContextIncludes(raw);
    },
  },
});
