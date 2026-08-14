import { describe, expect, it } from 'vitest';
import type { estypes } from '@elastic/elasticsearch';
import { SegmentResponse } from '@app/services/search/segmentDocument/SegmentResponse';
import type { SegmentDocumentShape } from '@app/services/search/SegmentDocument';
import { CategoryType, Media } from '@app/models';
import { decodeKeysetCursor } from '@lib/cursor';

type MediaInfoMap = Awaited<ReturnType<typeof Media.getMediaInfoMap>>;

/**
 * Media ids are also the titles under test, so the map is built from whatever
 * ids a case happens to use rather than from a fixed fixture -- a hit whose
 * media is missing from the map is dropped by the response builder, which would
 * read as "the reorder lost a row".
 */
function makeMediaInfoMap(mediaIds: number[]): MediaInfoMap {
  const results = new Map(
    mediaIds.map((mediaId) => [
      mediaId,
      {
        mediaId,
        publicId: `media-${mediaId}`,
        slug: `title-${mediaId}`,
        category: CategoryType.ANIME,
        categoryName: CategoryType.ANIME,
        nameRomaji: `Title ${mediaId}`,
        nameEn: null,
        nameJa: null,
        airingFormat: 'TV',
        airingStatus: 'FINISHED',
        genres: [],
        cover: null,
        banner: null,
        startDate: '2025-01-01',
        segmentCount: 10,
        episodeCount: 1,
        seasonName: 'WINTER',
        seasonYear: 2025,
        externalIds: {},
        storageBasePath: `anime/title-${mediaId}`,
      },
    ]),
  );

  return { results, stats: {} } as unknown as MediaInfoMap;
}

/** One hit, identified by segment id, belonging to `mediaId` and ranked at `score`. */
function hit(id: number, mediaId: number, score: number): estypes.SearchHit<SegmentDocumentShape> {
  return {
    _index: 'segments',
    _id: String(id),
    _score: score,
    // The trailing values stand in for the stable tie-breakers the sort builder
    // appends; only the first is the rank this reorder groups on.
    sort: [score, 27, mediaId, 1, id],
    _source: {
      uuid: `uuid-${id}`,
      publicId: `pub-${id}`,
      position: id,
      status: 'ACTIVE',
      startTimeMs: 0,
      endTimeMs: 1000,
      durationMs: 1000,
      textJa: 'テスト',
      characterCount: 3,
      textEn: 'Test',
      textEnMt: false,
      textEs: 'Prueba',
      textEsMt: false,
      contentRating: 'SAFE',
      storage: 'R2',
      hashedId: `hash-${id}`,
      category: 'ANIME',
      episode: 1,
      mediaId,
      storageBasePath: `anime/title-${mediaId}`,
    },
  } as estypes.SearchHit<SegmentDocumentShape>;
}

function esResponse(hits: estypes.SearchHit<SegmentDocumentShape>[]): estypes.SearchResponse {
  return {
    took: 1,
    timed_out: false,
    _shards: { total: 1, successful: 1, skipped: 0, failed: 0 },
    hits: { total: { value: hits.length, relation: 'eq' }, max_score: 1, hits },
  };
}

function build(hits: estypes.SearchHit<SegmentDocumentShape>[], preferred?: number[]) {
  const mediaIds = [...new Set(hits.map((h) => h._source!.mediaId))];
  return SegmentResponse.buildSearch(
    esResponse(hits),
    makeMediaInfoMap(mediaIds),
    preferred ? new Set(preferred) : undefined,
  );
}

const idsOf = (result: ReturnType<typeof build>) => result.segments.map((segment) => segment.id);

/**
 * The reader's own titles first among hits Elasticsearch ranked equally.
 *
 * The tests worth having here are the two boundaries, not the happy path: that
 * the reorder never crosses a rank boundary (or it is a boost, which is a
 * different feature and one that changes which segments a page holds), and that
 * the cursor keeps pointing at the last hit *Elasticsearch* returned (or
 * pagination repeats the rows this lifted and skips the ones they displaced).
 */
describe('buildSearch with preferred media', () => {
  it('lifts a preferred title above a title it is tied with', () => {
    // 1 and 2 are tied; 2 is the reader's, so it goes first.
    const result = build([hit(1, 10, 5), hit(2, 20, 5)], [20]);

    expect(idsOf(result)).toEqual([2, 1]);
  });

  it('leaves a better-ranked hit alone: a tie-break, not a boost', () => {
    // The reader's title is the *lower* scoring hit here. Lifting it would change
    // which segments a page holds, which is the thing this feature promises not
    // to do.
    const result = build([hit(1, 10, 9), hit(2, 20, 5)], [20]);

    expect(idsOf(result)).toEqual([1, 2]);
  });

  it('reorders within each tied run independently', () => {
    const result = build([hit(1, 10, 9), hit(2, 20, 9), hit(3, 10, 4), hit(4, 20, 4)], [20]);

    expect(idsOf(result)).toEqual([2, 1, 4, 3]);
  });

  it('keeps the order Elasticsearch gave inside the preferred group and inside the rest', () => {
    // Four-way tie, two of them the reader's. Both halves come out in arrival
    // order, so the ranking below the tie is not scrambled by the partition.
    const result = build([hit(1, 10, 5), hit(2, 20, 5), hit(3, 30, 5), hit(4, 20, 5)], [20]);

    expect(idsOf(result)).toEqual([2, 4, 1, 3]);
  });

  it('changes nothing when the reader owns all of a run, or none of it', () => {
    const hits = [hit(1, 20, 5), hit(2, 20, 5), hit(3, 10, 5)];

    expect(idsOf(build(hits, [20, 10]))).toEqual([1, 2, 3]);
    expect(idsOf(build(hits, [99]))).toEqual([1, 2, 3]);
    expect(idsOf(build(hits, []))).toEqual([1, 2, 3]);
    expect(idsOf(build(hits))).toEqual([1, 2, 3]);
  });

  it('cursors from the last hit Elasticsearch returned, not the last one shown', () => {
    // The reorder moves hit 3 off the end of the page. Were the cursor taken
    // from the reordered list it would resume after hit 1, so the next page
    // would serve hit 3 a second time.
    const hits = [hit(1, 10, 5), hit(2, 10, 5), hit(3, 20, 5)];
    const result = build(hits, [20]);

    expect(idsOf(result)).toEqual([3, 1, 2]);
    expect(decodeKeysetCursor(result.pagination.cursor!)).toEqual(hits[2].sort);
  });
});
