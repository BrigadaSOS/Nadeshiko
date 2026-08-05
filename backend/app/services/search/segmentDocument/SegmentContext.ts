import type { estypes } from '@elastic/elasticsearch';
import { client, INDEX_NAME } from '@config/elasticsearch';
import { logger } from '@config/log';
import { Media } from '@app/models';
import type { MediaOutput, SegmentContextResponseOutput, SegmentOutput } from 'generated/outputTypes';
import { SegmentQuery } from './SegmentQuery';
import { SegmentResponse } from './SegmentResponse';
import { isSuccessfulMsearchItem } from './errors';

/**
 * The segments around a given one: what a reader sees above and below the line
 * they landed on.
 */

export interface SurroundingSegmentsRequest {
  readonly mediaId: number;
  readonly episodeNumber: number;
  readonly segmentPosition: number;
  readonly limit?: number;
  readonly contentRating?: string[];
}

/** Default context window, split either side of the requested position. */
const DEFAULT_FORWARD_SIZE = 16;
const DEFAULT_BACKWARD_SIZE = 14;

export async function surroundingSegments(request: SurroundingSegmentsRequest): Promise<SegmentContextResponseOutput> {
  // Sub-search 0 walks forward from the requested position (inclusive), sub-search 1 walks backward.
  const contextSearches: estypes.MsearchRequestItem[] = [
    {},
    {
      sort: [{ position: { order: 'asc' } }],
      size: request.limit ? request.limit + 1 : DEFAULT_FORWARD_SIZE,
      query: SegmentQuery.buildUuidContext(
        request.mediaId,
        request.episodeNumber,
        { range: { position: { gte: request.segmentPosition } } },
        request.contentRating,
      ),
    },
    {},
    {
      sort: [{ position: { order: 'desc' } }],
      size: request.limit || DEFAULT_BACKWARD_SIZE,
      query: SegmentQuery.buildUuidContext(
        request.mediaId,
        request.episodeNumber,
        { range: { position: { lt: request.segmentPosition } } },
        request.contentRating,
      ),
    },
  ];

  const esResponse = await client.msearch({ index: INDEX_NAME, searches: contextSearches });
  const mediaMapData = await Media.getMediaInfoMap();

  const mergedMediaMap: Record<string, MediaOutput> = {};

  // One failed direction still leaves usable context, so each is collected
  // independently and a failure degrades that half rather than the whole request.
  const collect = (response: estypes.MsearchResponseItem | undefined, direction: string): SegmentOutput[] => {
    if (!isSuccessfulMsearchItem(response)) {
      logger.warn({ request, response }, `${direction} context sub-search failed`);
      return [];
    }

    const result = SegmentResponse.buildSearchResultSegments(response, mediaMapData);
    Object.assign(mergedMediaMap, result.mediaMap);
    return result.segments;
  };

  const forwardSegments = collect(esResponse.responses[0], 'Forward');
  const previousSegments = collect(esResponse.responses[1], 'Previous');

  const sortedSegments = [...previousSegments, ...forwardSegments].sort((a, b) => a.position - b.position);

  return { segments: sortedSegments, includes: { media: mergedMediaMap } };
}
