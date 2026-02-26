import type { estypes } from '@elastic/elasticsearch';
import { logger } from '@config/log';
import { type Storage, getSegmentImageUrl, getSegmentAudioUrl, getSegmentVideoUrl } from '@lib/utils/storage';
import { encodeKeysetCursor } from '@lib/cursor';
import type { Media } from '@app/models';
import type {
  PaginationInfoOutput,
  SearchResponseOutput,
  SearchMultipleResponseOutput,
  SegmentOutput,
  MediaOutput,
  MediaSearchStatsOutput,
  WordMatchOutput,
  WordMatchMediaOutput,
  SearchStatsResponseOutput,
} from 'generated/outputTypes';

type MediaInfoMap = Awaited<ReturnType<typeof Media.getMediaInfoMap>>;
type SearchStatisticsOutput = Pick<SearchStatsResponseOutput, 'media' | 'categories' | 'includes'>;

export class SegmentResponse {
  static buildSearch(esResponse: estypes.SearchResponse, mediaInfoResponse: MediaInfoMap): SearchResponseOutput {
    const { segments, mediaMap } = SegmentResponse.buildSearchResultSegments(esResponse, mediaInfoResponse);

    let cursor: string | undefined;
    if (esResponse.hits.hits.length >= 1) {
      const sortValue = esResponse.hits.hits[esResponse.hits.hits.length - 1]['sort'];
      if (sortValue) cursor = encodeKeysetCursor(sortValue as estypes.FieldValue[]);
    }

    return {
      segments,
      includes: { media: mediaMap },
      pagination: SegmentResponse.buildPagination(esResponse, cursor),
    };
  }

  static buildSearchResultSegments(
    esResponse: estypes.SearchResponse,
    mediaInfoResponse: MediaInfoMap,
  ): { segments: SegmentOutput[]; mediaMap: Record<string, MediaOutput> } {
    const mediaMap: Record<string, MediaOutput> = {};

    const segments = esResponse.hits.hits
      .map((hit: any) => {
        const data: any = hit['_source'];
        const highlight: any = hit['highlight'] || {};
        const segmentId = Number(hit['_id'] ?? data['id']);
        const mediaId = Number(data['mediaId']);
        const mediaInfo = mediaInfoResponse.results.get(mediaId);

        if (!mediaInfo) {
          logger.error({ mediaId: data['mediaId'] }, 'Media Info not found');
          return null;
        }
        if (!Number.isFinite(segmentId)) {
          logger.error({ uuid: data['uuid'], id: hit['_id'] }, 'Segment id missing in Elasticsearch hit');
          return null;
        }

        if (!(String(mediaId) in mediaMap)) {
          mediaMap[String(mediaId)] = SegmentResponse.buildMedia(mediaId, mediaInfo);
        }

        const hashedId = data['hashedId'];
        const storageBasePath = mediaInfo.storageBasePath;

        const storage: Storage = (data['storage'] || 'R2').toUpperCase() as Storage;
        const segmentForUrls = {
          mediaId: data['mediaId'],
          episode: data['episode'],
          storage,
          hashedId,
          storageBasePath,
        };

        const imageUrl = getSegmentImageUrl(segmentForUrls);
        const audioUrl = getSegmentAudioUrl(segmentForUrls);
        const videoUrl = getSegmentVideoUrl(segmentForUrls);

        const normalizedRating = String(data['contentRating'] ?? 'SAFE').toUpperCase();
        const contentRating: SegmentOutput['contentRating'] =
          normalizedRating === 'SUGGESTIVE' || normalizedRating === 'QUESTIONABLE' || normalizedRating === 'EXPLICIT'
            ? normalizedRating
            : 'SAFE';

        return {
          id: segmentId,
          status: data['status'],
          uuid: data['uuid'],
          position: data['position'],
          startTimeMs: data['startTimeMs'],
          endTimeMs: data['endTimeMs'],
          episode: data['episode'],
          mediaId,
          textJa: {
            content: SegmentResponse.toTextContent(data['textJa']),
            ...('textJa' in highlight ? { highlight: highlight['textJa'][0] } : {}),
          },
          textEn: {
            content: SegmentResponse.toTextContent(data['textEn']),
            ...('textEn' in highlight ? { highlight: highlight['textEn'][0] } : {}),
            isMachineTranslated: data['textEnMt'] ?? false,
          },
          textEs: {
            content: SegmentResponse.toTextContent(data['textEs']),
            ...('textEs' in highlight ? { highlight: highlight['textEs'][0] } : {}),
            isMachineTranslated: data['textEsMt'] ?? false,
          },
          contentRating,
          urls: { imageUrl, audioUrl, videoUrl },
        };
      })
      .filter(SegmentResponse.notEmpty);

    return { segments, mediaMap };
  }

  static buildMedia(mediaId: number, mediaInfo: any): MediaOutput {
    return {
      id: mediaId,
      externalIds: mediaInfo.externalIds,
      nameJa: mediaInfo.nameJa,
      nameRomaji: mediaInfo.nameRomaji,
      nameEn: mediaInfo.nameEn,
      airingFormat: mediaInfo.airingFormat,
      airingStatus: mediaInfo.airingStatus,
      genres: mediaInfo.genres,
      coverUrl: mediaInfo.cover,
      bannerUrl: mediaInfo.banner,
      startDate: mediaInfo.startDate,
      endDate: mediaInfo.endDate,
      category: mediaInfo.category as 'ANIME' | 'JDRAMA',
      segmentCount: mediaInfo.segmentCount,
      episodeCount: mediaInfo.episodeCount,
      studio: mediaInfo.studio,
      seasonName: mediaInfo.seasonName,
      seasonYear: mediaInfo.seasonYear,
    };
  }

  static buildPagination(esResponse: estypes.SearchResponse, cursor?: string): PaginationInfoOutput {
    const totalHits = esResponse.hits.total;
    let estimatedTotalHits = 0;
    let estimatedTotalHitsRelation: 'EXACT' | 'LOWER_BOUND' = 'EXACT';

    if (typeof totalHits === 'number') {
      estimatedTotalHits = totalHits;
    } else if (totalHits && typeof totalHits === 'object') {
      estimatedTotalHits = totalHits.value;
      estimatedTotalHitsRelation = totalHits.relation === 'gte' ? 'LOWER_BOUND' : 'EXACT';
    }

    const hasMore = Boolean(cursor);
    return { hasMore, estimatedTotalHits, estimatedTotalHitsRelation, cursor: hasMore ? (cursor ?? null) : null };
  }

  static buildWordsMatched(
    words: string[],
    esResponse: estypes.MsearchResponse,
    mediaInfoResponse: MediaInfoMap,
  ): SearchMultipleResponseOutput {
    const results: WordMatchOutput[] = [];
    const mediaMap: Record<string, MediaOutput> = {};

    for (const [word, response] of words.map((word, i): [string, estypes.SearchResponseBody] => [
      word,
      esResponse.responses[i] as estypes.SearchResponseBody,
    ])) {
      let isMatch = false;
      let matchCount = 0;

      if (response.hits?.total !== undefined) {
        isMatch = (response.hits.total as estypes.SearchTotalHits).value > 0;
        matchCount = (response.hits.total as estypes.SearchTotalHits).value;
      }

      let media: WordMatchMediaOutput[] = [];
      if (response.aggregations && 'group_by_media_id' in response.aggregations) {
        const mediaBuckets =
          (response.aggregations as Record<string, { buckets?: unknown[] }>).group_by_media_id?.buckets ?? [];
        media = mediaBuckets
          .map((bucket: any): WordMatchMediaOutput | null => {
            const mediaId = Number(bucket['key']);
            const mediaInfo = mediaInfoResponse.results.get(mediaId);
            if (!mediaInfo) return null;

            if (!(String(mediaId) in mediaMap)) {
              mediaMap[String(mediaId)] = SegmentResponse.buildMedia(mediaId, mediaInfo);
            }

            return { mediaId, matchCount: bucket['doc_count'] };
          })
          .filter((item): item is WordMatchMediaOutput => item !== null);
      }

      results.push({ word, isMatch, matchCount, media });
    }

    return { results, includes: { media: mediaMap } };
  }

  static buildStatistics(
    aggResponse: estypes.SearchResponse,
    mediaInfoResponse: MediaInfoMap,
  ): { stats: MediaSearchStatsOutput[]; mediaMap: Record<string, MediaOutput> } {
    const mediaMap: Record<string, MediaOutput> = {};

    if (!aggResponse.aggregations || !('group_by_media_id' in aggResponse.aggregations)) {
      return { stats: [], mediaMap };
    }

    const mediaAgg = aggResponse.aggregations[
      'group_by_media_id'
    ] as estypes.AggregationsTermsAggregateBase<estypes.AggregationsTermsBucketBase>;
    const mediaBuckets = (mediaAgg.buckets ?? []) as Array<Record<string, any>>;

    const stats = mediaBuckets
      .map((mediaBucket) => {
        const mediaId = Number(mediaBucket['key']);
        const mediaInfo = mediaInfoResponse.results.get(mediaId);
        if (!mediaInfo || !Object.keys(mediaInfo).length) return undefined;

        const episodeAgg = mediaBucket[
          'group_by_episode'
        ] as estypes.AggregationsTermsAggregateBase<estypes.AggregationsTermsBucketBase>;
        const episodeBuckets = (episodeAgg.buckets ?? []) as Array<Record<string, any>>;
        const episodesWithResults = episodeBuckets.reduce((acc: Record<string, number>, bucket) => {
          acc[bucket['key']] = bucket['doc_count'];
          return acc;
        }, {});

        if (!(String(mediaId) in mediaMap)) {
          mediaMap[String(mediaId)] = SegmentResponse.buildMedia(mediaId, mediaInfo);
        }

        return { mediaId, matchCount: Number(mediaBucket['doc_count']), episodeHits: episodesWithResults };
      })
      .filter(SegmentResponse.notEmpty);

    return { stats, mediaMap };
  }

  static buildCategoryStatistics(aggResponse: estypes.SearchResponse): SearchStatisticsOutput['categories'] {
    if (!aggResponse.aggregations || !('group_by_category' in aggResponse.aggregations)) return [];

    const categoryAgg = aggResponse.aggregations[
      'group_by_category'
    ] as estypes.AggregationsTermsAggregateBase<estypes.AggregationsTermsBucketBase>;
    const categoryBuckets = (categoryAgg.buckets ?? []) as Array<Record<string, any>>;
    return categoryBuckets.map((bucket) => ({ category: bucket['key'], count: bucket['doc_count'] }));
  }

  private static notEmpty<TValue>(value: TValue | null | undefined): value is TValue {
    return value !== null && value !== undefined;
  }

  private static toTextContent(value: unknown): string {
    return typeof value === 'string' ? value : '';
  }
}
