import type { estypes } from '@elastic/elasticsearch';
import { logger } from '@config/log';
import { type Storage, getSegmentImageUrl, getSegmentAudioUrl, getSegmentVideoUrl } from '@lib/utils/storage';
import { encodeKeysetCursor } from '@lib/cursor';
import type { Media } from '@app/models';
import type { SegmentDocumentShape } from '../SegmentDocument';
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
type MediaInfo = MediaInfoMap['results'] extends Map<number, infer T> ? T : never;
type SearchStatisticsOutput = Pick<SearchStatsResponseOutput, 'media' | 'categories' | 'includes'>;
type SegmentSearchHit = estypes.SearchHit<SegmentDocumentShape>;
type HighlightMap = Record<string, string[]>;
type TermsBucket = { key?: string | number; doc_count?: number } & Record<string, unknown>;
type TermsAggregation = { buckets?: TermsBucket[] };

export class SegmentResponse {
  static buildSearch(esResponse: estypes.SearchResponse, mediaInfoResponse: MediaInfoMap): SearchResponseOutput {
    const { segments, mediaMap } = SegmentResponse.buildSearchResultSegments(esResponse, mediaInfoResponse);

    let cursor: string | undefined;
    const hits = esResponse.hits.hits as SegmentSearchHit[];
    if (hits.length >= 1) {
      const sortValue = hits[hits.length - 1].sort;
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
    const hits = esResponse.hits.hits as SegmentSearchHit[];

    const segments = hits
      .map((hit) => {
        const data = hit._source;
        if (!data) {
          return null;
        }

        const highlight = (hit.highlight ?? {}) as HighlightMap;
        const segmentId = Number(hit._id);
        const mediaId = data.mediaId;
        const mediaInfo = mediaInfoResponse.results.get(mediaId);

        if (!mediaInfo) {
          logger.error({ mediaId: data.mediaId }, 'Media Info not found');
          return null;
        }
        if (!Number.isFinite(segmentId)) {
          logger.error({ uuid: data.uuid, id: hit._id }, 'Segment id missing in Elasticsearch hit');
          return null;
        }

        if (!(String(mediaId) in mediaMap)) {
          mediaMap[String(mediaId)] = SegmentResponse.buildMedia(mediaId, mediaInfo);
        }

        const storageBasePath = mediaInfo.storageBasePath;
        const storage: Storage = data.storage.toUpperCase() as Storage;
        const segmentForUrls = {
          mediaId,
          episode: data.episode,
          storage,
          hashedId: data.hashedId,
          storageBasePath,
        };

        const imageUrl = getSegmentImageUrl(segmentForUrls);
        const audioUrl = getSegmentAudioUrl(segmentForUrls);
        const videoUrl = getSegmentVideoUrl(segmentForUrls);

        const contentRating = SegmentResponse.toContentRating(data.contentRating);

        const textJaHighlight = highlight.textJa?.[0];
        const textEnHighlight = highlight.textEn?.[0];
        const textEsHighlight = highlight.textEs?.[0];

        return {
          id: segmentId,
          publicId: data.publicId,
          status: SegmentResponse.toSegmentStatus(data.status),
          uuid: data.uuid,
          position: data.position,
          startTimeMs: data.startTimeMs,
          endTimeMs: data.endTimeMs,
          episode: data.episode,
          mediaId,
          textJa: {
            content: data.textJa,
            ...(textJaHighlight ? { highlight: textJaHighlight } : {}),
          },
          textEn: {
            content: data.textEn,
            ...(textEnHighlight ? { highlight: textEnHighlight } : {}),
            isMachineTranslated: data.textEnMt,
          },
          textEs: {
            content: data.textEs,
            ...(textEsHighlight ? { highlight: textEsHighlight } : {}),
            isMachineTranslated: data.textEsMt,
          },
          contentRating,
          urls: { imageUrl, audioUrl, videoUrl },
        };
      })
      .filter(SegmentResponse.notEmpty);

    return { segments, mediaMap };
  }

  static buildMedia(mediaId: number, mediaInfo: MediaInfo): MediaOutput {
    return {
      id: mediaId,
      publicId: mediaInfo.publicId,
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
        const mediaBuckets = ((response.aggregations as Record<string, TermsAggregation>).group_by_media_id?.buckets ??
          []) as TermsBucket[];
        media = mediaBuckets
          .map((bucket): WordMatchMediaOutput | null => {
            const mediaId = Number(bucket.key);
            if (!Number.isFinite(mediaId)) return null;

            const mediaInfo = mediaInfoResponse.results.get(mediaId);
            if (!mediaInfo) return null;

            if (!(String(mediaId) in mediaMap)) {
              mediaMap[String(mediaId)] = SegmentResponse.buildMedia(mediaId, mediaInfo);
            }

            return { mediaId, matchCount: Number(bucket.doc_count ?? 0) };
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

    const mediaAgg = (aggResponse.aggregations as Record<string, TermsAggregation>).group_by_media_id;
    const mediaBuckets = (mediaAgg?.buckets ?? []) as TermsBucket[];

    const stats = mediaBuckets
      .map((mediaBucket) => {
        const mediaId = Number(mediaBucket.key);
        if (!Number.isFinite(mediaId)) {
          return undefined;
        }

        const mediaInfo = mediaInfoResponse.results.get(mediaId);
        if (!mediaInfo || !Object.keys(mediaInfo).length) return undefined;

        const episodeAgg = mediaBucket.group_by_episode as TermsAggregation | undefined;
        const episodeBuckets = (episodeAgg?.buckets ?? []) as TermsBucket[];
        const episodesWithResults = episodeBuckets.reduce((acc: Record<string, number>, bucket) => {
          const key = bucket.key;
          if (key !== undefined) {
            acc[String(key)] = Number(bucket.doc_count ?? 0);
          }
          return acc;
        }, {});

        if (!(String(mediaId) in mediaMap)) {
          mediaMap[String(mediaId)] = SegmentResponse.buildMedia(mediaId, mediaInfo);
        }

        return {
          mediaId,
          publicId: mediaInfo.publicId,
          matchCount: Number(mediaBucket.doc_count ?? 0),
          episodeHits: episodesWithResults,
        };
      })
      .filter(SegmentResponse.notEmpty);

    return { stats, mediaMap };
  }

  static buildCategoryStatistics(aggResponse: estypes.SearchResponse): SearchStatisticsOutput['categories'] {
    if (!aggResponse.aggregations || !('group_by_category' in aggResponse.aggregations)) return [];

    const categoryAgg = (aggResponse.aggregations as Record<string, TermsAggregation>).group_by_category;
    const categoryBuckets = (categoryAgg?.buckets ?? []) as TermsBucket[];
    return categoryBuckets
      .map((bucket) => {
        const category = bucket.key;
        if (!SegmentResponse.isCategory(category) || bucket.doc_count === undefined) {
          return null;
        }
        return { category, count: Number(bucket.doc_count) };
      })
      .filter(SegmentResponse.notEmpty);
  }

  private static notEmpty<TValue>(value: TValue | null | undefined): value is TValue {
    return value !== null && value !== undefined;
  }


  private static toContentRating(value: string): SegmentOutput['contentRating'] {
    const normalized = value.toUpperCase();
    switch (normalized) {
      case 'SUGGESTIVE':
      case 'QUESTIONABLE':
      case 'EXPLICIT':
        return normalized;
      default:
        return 'SAFE';
    }
  }

  private static toSegmentStatus(value: string): SegmentOutput['status'] {
    switch (value) {
      case 'DELETED':
      case 'ACTIVE':
      case 'SUSPENDED':
      case 'VERIFIED':
      case 'INVALID':
      case 'TOO_LONG':
        return value;
      default:
        return 'ACTIVE';
    }
  }

  private static isCategory(value: unknown): value is 'ANIME' | 'JDRAMA' {
    return value === 'ANIME' || value === 'JDRAMA';
  }
}
