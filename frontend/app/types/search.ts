export type {
  SearchFilters,
  MediaFilterItem,
  Segment,
  Media,
  CategoryCount,
  SearchResponse as SdkSearchResponse,
  SearchStatsResponse as SdkSearchStatsResponse,
  SearchMultipleResponse as SdkSearchMultipleResponse,
  SegmentContextResponse as SdkSegmentContextResponse,
  MediaListResponse as SdkMediaListResponse,
} from '@brigadasos/nadeshiko-sdk';

import type { Media, Segment, MediaSearchStats, PaginationInfo, WordMatchMedia } from '@brigadasos/nadeshiko-sdk';

/** A search result with includes resolved (segment joined with its media). */
export type SearchResult = {
  media: Media;
  segment: Segment;
  /** Client-side audio concatenation blob, set by useSegmentConcatenation. */
  blobAudio: Blob | null;
  blobAudioUrl: string | null;
};

/** Search response with includes resolved into flat SearchResult array. */
export type SearchResponse = {
  results: SearchResult[];
  pagination?: PaginationInfo;
};

/** MediaSearchStats enriched with media metadata from includes. */
export type ResolvedMediaStats = MediaSearchStats &
  Pick<Media, 'nameRomaji' | 'nameEn' | 'nameJa' | 'category' | 'airingFormat'>;

export type ResolvedCategoryCount = {
  category: 'ANIME' | 'JDRAMA';
  count: number;
};

export type SearchStatsResponse = {
  media: ResolvedMediaStats[];
  categories: ResolvedCategoryCount[];
};

export type MediaBrowseResponse = {
  readonly media: Media[];
  readonly cursor?: string | null;
  readonly hasMore: boolean;
};

export type SegmentContextResponse = {
  segments: SearchResult[];
};

export type MultiSearchResult = {
  word: string;
  isMatch: boolean;
  matchCount: number;
  media?: Array<WordMatchMedia>;
};

export type MultiSearchResponse = {
  results: MultiSearchResult[];
};
