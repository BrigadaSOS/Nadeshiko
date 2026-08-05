export type {
  SearchFilters,
  MediaFilterItem,
  Segment,
  CategoryCount,
  Media,
  SearchResponse as SdkSearchResponse,
  SearchStatsResponse as SdkSearchStatsResponse,
  SearchMultipleResponse as SdkSearchMultipleResponse,
  SegmentContextResponse as SdkSegmentContextResponse,
  MediaListResponse as SdkMediaListResponse,
} from '@brigadasos/nadeshiko-sdk';

import type {
  Category,
  Media,
  Segment,
  MediaSearchStats,
  SearchPagination,
  WordMatchMedia,
} from '@brigadasos/nadeshiko-sdk';

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
  pagination?: SearchPagination;
};

/** MediaSearchStats enriched with media metadata from includes. */
export type ResolvedMediaStats = MediaSearchStats &
  Pick<Media, 'nameRomaji' | 'nameEn' | 'nameJa' | 'category' | 'airingFormat' | 'slug'>;

export type ResolvedCategoryCount = {
  category: Category;
  count: number;
  /** Count with the hidden-media exclusion lifted; equals `count` when no exclusion is in effect. */
  realCount: number;
};

export type SearchStatsResponse = {
  media: ResolvedMediaStats[];
  categories: ResolvedCategoryCount[];
};

/**
 * The subset of the merged search state (results + stats) that the sidebar and its filter
 * panels read. Kept structural so it stays decoupled from how the container assembles it.
 */
export type SearchSidebarData = {
  results?: SearchResult[];
  media?: ResolvedMediaStats[];
  categories?: ResolvedCategoryCount[];
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
