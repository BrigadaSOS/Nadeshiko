import type { estypes } from '@elastic/elasticsearch';
import { logger } from '@config/log';
import { type Storage, getSegmentImageUrl, getSegmentAudioUrl, getSegmentVideoUrl } from '@lib/utils/storage';
import { encodeKeysetCursor } from '@lib/cursor';
import type { Media } from '@app/models';
import { ALL_CATEGORIES, type CategoryType } from '@app/models';
import type { SegmentDocumentShape } from '../SegmentDocument';
import type { SlimToken } from '@app/models/Segment';
import { enhanceHighlight } from './HighlightEnhancer';
import { isSuccessfulMsearchItem } from './errors';
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
  static buildSearch(
    esResponse: estypes.SearchResponse,
    mediaInfoResponse: MediaInfoMap,
    preferredMediaIds?: ReadonlySet<number>,
  ): SearchResponseOutput {
    const hits = esResponse.hits.hits as SegmentSearchHit[];

    // The cursor is read before the reorder below, and that ordering is the whole
    // reason the reorder is safe. `search_after` resumes from the sort values of
    // the last hit *Elasticsearch* returned; take them from the last hit the
    // reader is shown instead and every tie moved to the top of a page becomes a
    // row the next page repeats, while the one it displaced is skipped.
    let cursor: string | undefined;
    const lastHit = hits[hits.length - 1];
    if (lastHit) {
      const sortValue = lastHit.sort;
      if (sortValue) cursor = encodeKeysetCursor(sortValue as estypes.FieldValue[]);
    }

    if (preferredMediaIds?.size) {
      esResponse.hits.hits = preferTiedMedia(hits, preferredMediaIds);
    }
    const { segments, mediaMap } = SegmentResponse.buildSearchResultSegments(esResponse, mediaInfoResponse);

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
          externalVideoId: data.externalVideoId,
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
          externalVideoId: data.externalVideoId ?? null,
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

    // p1/p2/p4/cf used to be filled in here, nullable, because the published
    // schema required them even when Sudachi had nothing to put in the slot.
    // The fields are gone from the schema, so there is nothing to pad.
    return tokens.map((token) => ({
      ...token,
      kind: SegmentResponse.toTokenKind(token.kind),
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
        youtube: mediaInfo.externalIds.youtube ?? null,
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
      category: mediaInfo.category as MediaOutput['category'],
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
    hasRealCountQueries: boolean,
  ): SearchMultipleResponseOutput {
    const results: WordMatchOutput[] = [];
    const mediaMap: Record<string, MediaOutput> = {};
    const stride = hasRealCountQueries ? 2 : 1;

    for (const [i, word] of words.entries()) {
      const item = esResponse.responses[i * stride];
      if (!isSuccessfulMsearchItem(item)) {
        logger.warn({ word, response: item }, 'Word match sub-search failed');
        results.push({ word, isMatch: false, matchCount: 0, realMatchCount: 0, media: [] });
        continue;
      }
      const response = item as estypes.SearchResponseBody;

      let isMatch = false;
      let matchCount = 0;

      if (response.hits?.total !== undefined) {
        isMatch = (response.hits.total as estypes.SearchTotalHits).value > 0;
        matchCount = (response.hits.total as estypes.SearchTotalHits).value;
      }

      let realMatchCount = matchCount;
      if (hasRealCountQueries) {
        // True when wordsMatched() ran a second real-count query for each word.
        const realItem = esResponse.responses[i * stride + 1];
        if (isSuccessfulMsearchItem(realItem)) {
          const realTotal = (realItem as estypes.SearchResponseBody).hits?.total as estypes.SearchTotalHits | undefined;
          realMatchCount = realTotal?.value ?? matchCount;
        } else {
          logger.warn({ word, response: realItem }, 'Word match real-count sub-search failed');
        }
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

      results.push({ word, isMatch, matchCount, realMatchCount, media });
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

  static buildCategoryStatistics(
    aggResponse: estypes.SearchResponse,
    realAggResponse?: estypes.SearchResponse | null,
  ): SearchStatisticsOutput['categories'] {
    if (!aggResponse.aggregations || !('group_by_category' in aggResponse.aggregations)) return [];

    const realCountByCategory = new Map<string, number>();
    if (realAggResponse?.aggregations && 'group_by_category' in realAggResponse.aggregations) {
      const realAgg = (realAggResponse.aggregations as Record<string, TermsAggregation>).group_by_category;
      for (const bucket of (realAgg?.buckets ?? []) as TermsBucket[]) {
        if (bucket.key !== undefined && bucket.doc_count !== undefined) {
          realCountByCategory.set(String(bucket.key), Number(bucket.doc_count));
        }
      }
    }

    const categoryAgg = (aggResponse.aggregations as Record<string, TermsAggregation>).group_by_category;
    const categoryBuckets = (categoryAgg?.buckets ?? []) as TermsBucket[];
    return categoryBuckets
      .map((bucket) => {
        const category = bucket.key;
        if (!SegmentResponse.isCategory(category) || bucket.doc_count === undefined) {
          return null;
        }
        const count = Number(bucket.doc_count);
        const realCount = realAggResponse ? (realCountByCategory.get(String(category)) ?? count) : count;
        return { category, count, realCount };
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

  private static toTokenKind(value: string | undefined): NonNullable<TokenOutput>[number]['kind'] {
    switch (value) {
      case 'word':
      case 'compound':
      case 'inflected':
      case 'counter':
      case 'function':
      case 'expression':
      case 'symbol':
        return value;
      // Shirabe may name a kind we do not publish yet. Leaving the field off says we have
      // nothing to tell; picking one of ours would be inventing a grammatical category.
      default:
        return undefined;
    }
  }

  private static isCategory(value: unknown): value is CategoryType {
    return ALL_CATEGORIES.includes(value as CategoryType);
  }
}

/**
 * Lifts the reader's own titles to the front of each run of equally-ranked hits,
 * leaving every other pair exactly where Elasticsearch put it.
 *
 * A tie-break, not a boost. Nothing here crosses a rank boundary, so the set of
 * segments on the page is untouched: a search that would not have surfaced a
 * favourite still does not surface it, and a reader who favourites everything
 * sees the same results in the same order as one who favourites nothing. The
 * only thing that moves is the order inside a run the ranking itself had no
 * opinion about.
 *
 * The grouping key is the first sort value rather than `_score`, because that is
 * the primary key whichever branch of the sort builder ran -- queryless browse
 * sorts on `characterCount` and leaves `_score` null, and grouping on null would
 * make one run of the whole page.
 */
function preferTiedMedia(
  hits: estypes.SearchHit<SegmentDocumentShape>[],
  preferredMediaIds: ReadonlySet<number>,
): estypes.SearchHit<SegmentDocumentShape>[] {
  const isPreferred = (hit: estypes.SearchHit<SegmentDocumentShape>): boolean => {
    const mediaId = hit._source?.mediaId;
    return mediaId !== undefined && preferredMediaIds.has(mediaId);
  };

  // Compared as strings so a run is "same primary sort value" without caring
  // whether that value arrived as a float, an int or a string from a keyword
  // field. Computed once per hit rather than once per comparison.
  const rank = hits.map((hit) => String(hit.sort?.[0] ?? ''));

  const ordered: estypes.SearchHit<SegmentDocumentShape>[] = [];
  for (let start = 0; start < hits.length; ) {
    let end = start + 1;
    while (end < hits.length && rank[end] === rank[start]) end += 1;

    if (end - start > 1) {
      const run = hits.slice(start, end);
      const mine = run.filter(isPreferred);
      // Both `filter` calls keep their input order, so a run that is all mine or
      // none of mine comes out byte-identical to the one that went in.
      ordered.push(...mine, ...run.filter((hit) => !isPreferred(hit)));
    } else {
      ordered.push(hits[start]!);
    }

    start = end;
  }

  return ordered;
}
