import type {
  Media,
  Segment,
  CategoryCount,
  SdkSearchResponse,
  SdkSearchStatsResponse,
  SdkSearchMultipleResponse,
  SdkSegmentContextResponse,
  SdkMediaListResponse,
  SearchResult,
  SearchResponse,
  SearchStatsResponse,
  ResolvedMediaStats,
  ResolvedCategoryCount,
  SegmentContextResponse,
  MultiSearchResponse,
  MediaBrowseResponse,
} from '~/types/search';
import type { WordMatch } from '@brigadasos/nadeshiko-sdk';

const EMPTY_MEDIA: Media = {
  id: 0,
  externalIds: {},
  nameJa: '',
  nameRomaji: '',
  nameEn: '',
  airingFormat: '',
  airingStatus: '',
  genres: [],
  coverUrl: '',
  bannerUrl: '',
  startDate: '',
  category: 'ANIME',
  segmentCount: 0,
  episodeCount: 0,
  studio: '',
  seasonName: '',
  seasonYear: 0,
};

function resolveSearchResult(segment: Segment, mediaMap: Record<string, Media>): SearchResult {
  return {
    media: mediaMap[String(segment.mediaId)] ?? { ...EMPTY_MEDIA, id: segment.mediaId },
    segment,
    blobAudio: null,
    blobAudioUrl: null,
  };
}

export function resolveSearchResponse(raw: SdkSearchResponse): SearchResponse {
  const mediaMap = raw.includes?.media ?? {};
  return {
    results: raw.segments?.map((s) => resolveSearchResult(s, mediaMap)) ?? [],
    pagination: raw.pagination,
  };
}

export function resolveContextResponse(raw: SdkSegmentContextResponse): SegmentContextResponse {
  const mediaMap = raw.includes?.media ?? {};
  return {
    segments: raw.segments?.map((s) => resolveSearchResult(s, mediaMap)) ?? [],
  };
}

export function resolveStatsResponse(raw: SdkSearchStatsResponse): SearchStatsResponse {
  const mediaMap = raw.includes?.media ?? {};

  const media: ResolvedMediaStats[] =
    raw.media?.map((stat) => {
      const included = mediaMap[String(stat.mediaId)];
      return {
        ...stat,
        nameRomaji: included?.nameRomaji ?? '',
        nameEn: included?.nameEn ?? '',
        nameJa: included?.nameJa ?? '',
        category: included?.category ?? 'ANIME',
        airingFormat: included?.airingFormat ?? '',
      };
    }) ?? [];

  const categories: ResolvedCategoryCount[] =
    raw.categories
      ?.filter(
        (c): c is CategoryCount & { category: 'ANIME' | 'JDRAMA'; count: number } =>
          (c.category === 'ANIME' || c.category === 'JDRAMA') && typeof c.count === 'number',
      )
      .map((c) => ({ category: c.category, count: c.count })) ?? [];

  return { media, categories };
}

export function resolveWordsResponse(raw: SdkSearchMultipleResponse): MultiSearchResponse {
  return {
    results:
      raw.results?.map((entry: WordMatch) => ({
        word: entry.word ?? '',
        isMatch: entry.isMatch ?? (entry.matchCount ?? 0) > 0,
        matchCount: entry.matchCount ?? 0,
        media: entry.media,
      })) ?? [],
  };
}

export function resolveMediaBrowseResponse(raw: SdkMediaListResponse): MediaBrowseResponse {
  return {
    media: raw.media ?? [],
    cursor: raw.pagination?.cursor ?? null,
    hasMore: raw.pagination?.hasMore ?? false,
  };
}
