export interface QuerySurroundingSegmentsRequest {
  readonly mediaId: number;
  readonly episodeNumber: number;
  readonly segmentPosition: number;
  readonly limit?: number;
  readonly contentRating?: string[];
}
