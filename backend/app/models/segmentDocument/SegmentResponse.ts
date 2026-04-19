import type { estypes } from '@elastic/elasticsearch';
import { logger } from '@config/log';
import { type Storage, getSegmentImageUrl, getSegmentAudioUrl, getSegmentVideoUrl } from '@lib/utils/storage';
import { encodeKeysetCursor } from '@lib/cursor';
import type { Media } from '@app/models';
import type { SegmentDocumentShape, SlimToken } from '../SegmentDocument';
import { enhanceHighlight } from './HighlightEnhancer';
import type {
  SearchPaginationOutput,
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
type TokenOutput = SegmentOutput['textJa']['tokens'];

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

        if (!(mediaInfo.publicId in mediaMap)) {
          mediaMap[mediaInfo.publicId] = SegmentResponse.buildMedia(mediaInfo);
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

        const rawTokens: SlimToken[] | undefined = data.tokens ?? undefined;
        const tokens = SegmentResponse.normalizeTokens(rawTokens);
        const enhancedHighlight =
          rawTokens && textJaHighlight ? enhanceHighlight(textJaHighlight, rawTokens) : textJaHighlight;

        return {
          id: segmentId,
          publicId: data.publicId,
          status: SegmentResponse.toSegmentStatus(data.status),
          position: data.position,
          startTimeMs: data.startTimeMs,
          endTimeMs: data.endTimeMs,
          episode: data.episode,
          mediaId,
          mediaPublicId: mediaInfo.publicId,
          textJa: {
            content: data.textJa,
            highlight: enhancedHighlight ?? null,
            tokens: tokens ?? null,
          },
          textEn: {
            content: data.textEn,
            highlight: textEnHighlight ?? null,
            isMachineTranslated: data.textEnMt,
          },
          textEs: {
            content: data.textEs,
            highlight: textEsHighlight ?? null,
            isMachineTranslated: data.textEsMt,
          },
          contentRating,
          urls: { imageUrl, audioUrl, videoUrl },
        };
      })
      .filter(SegmentResponse.notEmpty);

    return { segments, mediaMap };
  }

  static normalizeTokens(tokens?: SlimToken[]): TokenOutput {
    if (!tokens || tokens.length === 0) {
      return null;
    }

    return tokens.map((token) => ({
      ...token,
      p1: token.p1 ?? null,
      p2: token.p2 ?? null,
      p4: token.p4 ?? null,
      cf: token.cf ?? null,
    }));
  }

  static buildMedia(mediaInfo: MediaInfo): MediaOutput {
    return {
      publicId: mediaInfo.publicId,
      slug: mediaInfo.slug,
      externalIds: {
        anilist: mediaInfo.externalIds.anilist ?? null,
        imdb: mediaInfo.externalIds.imdb ?? null,
        tmdb: mediaInfo.externalIds.tmdb ?? null,
        tvdb: mediaInfo.externalIds.tvdb ?? null,
      },
      nameJa: mediaInfo.nameJa,
      nameRomaji: mediaInfo.nameRomaji,
      nameEn: mediaInfo.nameEn,
      airingFormat: mediaInfo.airingFormat as MediaOutput['airingFormat'],
      airingStatus: mediaInfo.airingStatus as MediaOutput['airingStatus'],
      genres: mediaInfo.genres,
      coverUrl: mediaInfo.cover,
      bannerUrl: mediaInfo.banner,
      startDate: mediaInfo.startDate,
      endDate: mediaInfo.endDate ?? null,
      category: mediaInfo.category as 'ANIME' | 'JDRAMA',
      segmentCount: mediaInfo.segmentCount,
      episodeCount: mediaInfo.episodeCount,
      studio: mediaInfo.studio ?? null,
      seasonName: mediaInfo.seasonName as MediaOutput['seasonName'],
      seasonYear: mediaInfo.seasonYear,
    };
  }

  static buildPagination(esResponse: estypes.SearchResponse, cursor?: string): SearchPaginationOutput {
    const totalHits = esResponse.hits.total;
    let estimatedTotalHits = 0;
    let estimatedTotalHitsRelation: 'EXACT' | 'AT_LEAST' = 'EXACT';

    if (typeof totalHits === 'number') {
      estimatedTotalHits = totalHits;
    } else if (totalHits && typeof totalHits === 'object') {
      estimatedTotalHits = totalHits.value;
      estimatedTotalHitsRelation = totalHits.relation === 'gte' ? 'AT_LEAST' : 'EXACT';
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

            if (!(mediaInfo.publicId in mediaMap)) {
              mediaMap[mediaInfo.publicId] = SegmentResponse.buildMedia(mediaInfo);
            }

            return { mediaPublicId: mediaInfo.publicId, matchCount: Number(bucket.doc_count ?? 0) };
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

        if (!(mediaInfo.publicId in mediaMap)) {
          mediaMap[mediaInfo.publicId] = SegmentResponse.buildMedia(mediaInfo);
        }

        return {
          mediaPublicId: mediaInfo.publicId,
          matchCount: Number(mediaBucket.doc_count ?? 0),
          episodeHits: Object.entries(episodesWithResults).map(([ep, hitCount]) => ({
            episode: Number(ep),
            hitCount,
          })),
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
      case 'ACTIVE':
      case 'HIDDEN':
      case 'DELETED':
        return value;
      // Legacy values → map to HIDDEN
      case 'SUSPENDED':
      case 'INVALID':
      case 'TOO_LONG':
        return 'HIDDEN';
      case 'VERIFIED':
        return 'ACTIVE';
      default:
        return 'ACTIVE';
    }
  }

  private static isCategory(value: unknown): value is 'ANIME' | 'JDRAMA' {
    return value === 'ANIME' || value === 'JDRAMA';
  }
}
