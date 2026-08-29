import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setupTestSuite } from '../../helpers/setup';
import { loadFixtures } from '../../fixtures/loader';
import { Episode, Media, Segment } from '@app/models';
import { ContentRating, SegmentStatus, SegmentStorage } from '@app/models/Segment';

/**
 * Writing segments into the search index.
 *
 * The interesting behaviour is not "does it index" -- it is the ACCOUNTING when
 * some of a batch fails, because that number is what an operator reads to decide
 * whether a reindex worked. Elasticsearch's bulk API answers 200 with per-item
 * errors inside the body, so a batch where half the documents were rejected is,
 * at the HTTP level, a success. Miscounting there means a reindex that dropped
 * thousands of segments reports "completed" and nobody looks again.
 *
 * Two specific cases carry that:
 *
 * - A segment whose media row is missing is counted as FAILED and named, rather
 *   than skipped silently. It is the shape a partial delete leaves behind.
 * - A delete of something already gone is counted as SUCCEEDED. The goal is that
 *   the document is not in the index; it already is not, and reporting failure
 *   sends somebody after a problem that does not exist.
 *
 * The ES client is stubbed rather than driven for real: what is under test is
 * how this class reads a bulk response, and a live index would only ever hand
 * back the success case.
 */
// `vi.hoisted`, because the mock factory below is lifted above every `const` in
// this file and would otherwise close over an uninitialised binding.
const esClient = vi.hoisted(() => ({
  index: vi.fn(),
  delete: vi.fn(),
  bulk: vi.fn(),
}));
vi.mock('@config/elasticsearch', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@config/elasticsearch')>()),
  client: esClient,
}));

const { SegmentIndexer } = await import('@app/services/search/segmentDocument/SegmentIndexer');

setupTestSuite();

let mediaId: number;
let counter = 0;

/** A segment belonging to the fixture media unless told otherwise. */
async function seedSegment(overrides: Partial<Segment> = {}): Promise<Segment> {
  counter += 1;
  return Segment.save(
    Segment.create({
      uuid: `indexer-seg-${counter}`,
      publicId: `pub-indexer-${counter}`,
      position: counter,
      status: SegmentStatus.ACTIVE,
      startTimeMs: 1000,
      endTimeMs: 2000,
      contentJa: `ja-${counter}`,
      contentEn: `en-${counter}`,
      contentEnMt: false,
      contentEs: `es-${counter}`,
      contentEsMt: false,
      contentRating: ContentRating.SAFE,
      ratingAnalysis: { scores: {}, tags: {} },
      storage: SegmentStorage.R2,
      hashedId: `indexer-hash-${counter}`,
      storageBasePath: '/test',
      episode: 1,
      mediaId,
      ...overrides,
    } as Partial<Segment>) as Segment,
  );
}

/** An episode row, which `Segment.episode` has a foreign key onto. */
async function seedEpisode(onMediaId: number, episodeNumber: number) {
  return Episode.save(
    Episode.create({ mediaId: onMediaId, episodeNumber, titleEn: `Ep ${episodeNumber}`, segmentCount: 0 } as never),
  );
}

/**
 * A segment that is NOT in the database, pointing at a media row that does not
 * exist. A foreign key makes that state unreachable through a save, but it is
 * reachable through the caller: the sync worker hands `bulkIndex` segments it
 * read moments ago, and the media can be deleted in between.
 */
function orphanSegment(id: number): Segment {
  return { id, mediaId: 99_999_999, uuid: `orphan-${id}`, publicId: `pub-orphan-${id}` } as Segment;
}

/** A bulk response in which every item succeeded. */
function bulkOk(count: number) {
  return { errors: false, items: Array.from({ length: count }, () => ({ index: {} })) };
}

/** A bulk index response where the named ids were rejected. */
function bulkWithIndexErrors(ids: number[], okCount: number) {
  return {
    errors: true,
    items: [
      ...Array.from({ length: okCount }, () => ({ index: {} })),
      ...ids.map((id) => ({
        index: { _id: String(id), error: { type: 'mapper_parsing_exception', reason: 'bad field' } },
      })),
    ],
  };
}

beforeEach(async () => {
  vi.clearAllMocks();
  esClient.index.mockResolvedValue({});
  esClient.delete.mockResolvedValue({});
  esClient.bulk.mockResolvedValue(bulkOk(0));
  await Segment.query('DELETE FROM "Segment"');
  const fixtures = await loadFixtures(['mediaWithEpisode']);
  mediaId = fixtures.media.testShow!.id;
});

describe('index', () => {
  it('writes the segment to the index', async () => {
    const segment = await seedSegment();

    expect(await SegmentIndexer.index(segment)).toBe(true);
    expect(esClient.index).toHaveBeenCalledTimes(1);
  });

  it('keys the document on the segment id, so a re-index replaces rather than duplicates', async () => {
    const segment = await seedSegment();

    await SegmentIndexer.index(segment);

    expect(esClient.index.mock.calls[0]![0]).toMatchObject({ id: String(segment.id) });
  });

  it('refuses a segment whose media row is gone, rather than indexing a nameless document', async () => {
    expect(await SegmentIndexer.index(orphanSegment(1))).toBe(false);
    expect(esClient.index).not.toHaveBeenCalled();
  });

  it('reports failure rather than throwing when the index refuses the write', async () => {
    // The caller is a subscriber on a database write that has already
    // committed; throwing here would roll nothing back and lose the segment.
    esClient.index.mockRejectedValue(new Error('cluster_block_exception'));
    const segment = await seedSegment();

    expect(await SegmentIndexer.index(segment)).toBe(false);
  });
});

describe('bulkIndex', () => {
  it('does nothing at all for an empty batch', async () => {
    expect(await SegmentIndexer.bulkIndex([])).toEqual({ succeeded: 0, failed: 0, errors: [] });
    expect(esClient.bulk).not.toHaveBeenCalled();
  });

  it('counts every document when the whole batch landed', async () => {
    const segments = [await seedSegment(), await seedSegment()];
    esClient.bulk.mockResolvedValue(bulkOk(2));

    expect(await SegmentIndexer.bulkIndex(segments)).toMatchObject({ succeeded: 2, failed: 0 });
  });

  it('sends one action and one document per segment', async () => {
    // The bulk body is action/document pairs; sending them out of step indexes
    // the wrong document under the wrong id.
    const segments = [await seedSegment(), await seedSegment()];
    esClient.bulk.mockResolvedValue(bulkOk(2));

    await SegmentIndexer.bulkIndex(segments);

    expect(esClient.bulk.mock.calls[0]![0].operations).toHaveLength(4);
  });

  it('splits succeeded from failed when only some documents were rejected', async () => {
    // The case the HTTP status cannot tell you about: ES answers 200 with the
    // failures inside the body.
    const segments = [await seedSegment(), await seedSegment()];
    esClient.bulk.mockResolvedValue(bulkWithIndexErrors([segments[1]!.id], 1));

    const result = await SegmentIndexer.bulkIndex(segments);

    expect(result).toMatchObject({ succeeded: 1, failed: 1 });
    expect(result.errors).toEqual([{ segmentId: segments[1]!.id, error: 'bad field' }]);
  });

  it('names a segment whose media is missing instead of dropping it quietly', async () => {
    // The shape a partial delete leaves behind, and the one where a silent skip
    // makes a reindex report more documents than it wrote.
    const good = await seedSegment();
    const orphan = orphanSegment(999);
    esClient.bulk.mockResolvedValue(bulkOk(1));

    const result = await SegmentIndexer.bulkIndex([good, orphan]);

    expect(result).toMatchObject({ succeeded: 1, failed: 1 });
    expect(result.errors[0]).toMatchObject({ segmentId: orphan.id });
  });

  it('does not call the index at all when every segment was orphaned', async () => {
    const result = await SegmentIndexer.bulkIndex([orphanSegment(999)]);

    expect(esClient.bulk).not.toHaveBeenCalled();
    expect(result).toMatchObject({ succeeded: 0, failed: 1 });
  });

  it('looks each media up once, however many segments share it', async () => {
    // A batch is 500 segments from a handful of titles; one query per segment
    // would be 500 round trips to count the same few rows.
    const segments = [await seedSegment(), await seedSegment(), await seedSegment()];
    esClient.bulk.mockResolvedValue(bulkOk(3));
    const findSpy = vi.spyOn(Media, 'find');

    await SegmentIndexer.bulkIndex(segments);

    expect(findSpy).toHaveBeenCalledTimes(1);
    findSpy.mockRestore();
  });

  it('writes to an explicitly named index when one is given', async () => {
    // A zero-downtime reindex builds into a new index and swaps the alias; a
    // target that was ignored would rewrite the live one instead.
    const segments = [await seedSegment()];
    esClient.bulk.mockResolvedValue(bulkOk(1));

    await SegmentIndexer.bulkIndex(segments, 'nadedb_rebuild');

    const [action] = esClient.bulk.mock.calls[0]![0].operations;
    expect(action.index._index).toBe('nadedb_rebuild');
  });
});

describe('delete', () => {
  it('removes the document', async () => {
    expect(await SegmentIndexer.delete(42)).toBe(true);
    expect(esClient.delete).toHaveBeenCalledWith(expect.objectContaining({ id: '42' }));
  });

  it('treats a document that was already gone as a success', async () => {
    // The goal is that it is not in the index. It already is not.
    //
    // The status lives on `meta`, not on the error itself -- see
    // `lib/elasticsearchErrors`. That distinction is the point: an unreachable
    // cluster has no `meta` at all, and must NOT be read as a 404.
    esClient.delete.mockRejectedValue(Object.assign(new Error('not found'), { meta: { statusCode: 404 } }));

    expect(await SegmentIndexer.delete(42)).toBe(true);
  });

  it('does NOT treat an unreachable cluster as an already-deleted document', async () => {
    // A connection error carries no status. Reading it as a 404 would report
    // the delete as done while the document is still in the index.
    esClient.delete.mockRejectedValue(new Error('connect ECONNREFUSED'));

    expect(await SegmentIndexer.delete(42)).toBe(false);
  });

  it('treats a missing-document error as a success too', async () => {
    esClient.delete.mockRejectedValue(new Error('document_missing_exception'));

    expect(await SegmentIndexer.delete(42)).toBe(true);
  });

  it('reports a real failure as one', async () => {
    esClient.delete.mockRejectedValue(new Error('cluster_block_exception'));

    expect(await SegmentIndexer.delete(42)).toBe(false);
  });
});

describe('bulkDelete', () => {
  /** A bulk delete response where each id got the given outcome. */
  function bulkDeleteResponse(items: ({ ok: true } | { errorType: string; id: number })[]) {
    return {
      errors: items.some((i) => 'errorType' in i),
      items: items.map((i) =>
        'ok' in i ? { delete: {} } : { delete: { _id: String(i.id), error: { type: i.errorType, reason: 'nope' } } },
      ),
    };
  }

  it('does nothing for an empty list', async () => {
    expect(await SegmentIndexer.bulkDelete([])).toEqual({ succeeded: 0, failed: 0, errors: [] });
    expect(esClient.bulk).not.toHaveBeenCalled();
  });

  it('counts every removal', async () => {
    esClient.bulk.mockResolvedValue(bulkDeleteResponse([{ ok: true }, { ok: true }]));

    expect(await SegmentIndexer.bulkDelete([1, 2])).toMatchObject({ succeeded: 2, failed: 0 });
  });

  it('counts a document that was already gone as REMOVED, not as a failure', async () => {
    // Deleting a segment that never made it into the index is the ordinary
    // outcome of a retry, and reporting it as a failure makes every retry look
    // like a broken run.
    esClient.bulk.mockResolvedValue(bulkDeleteResponse([{ errorType: 'document_missing_exception', id: 7 }]));

    expect(await SegmentIndexer.bulkDelete([7])).toMatchObject({ succeeded: 1, failed: 0, errors: [] });
  });

  it('counts any other error as a failure, and names it', async () => {
    esClient.bulk.mockResolvedValue(bulkDeleteResponse([{ errorType: 'cluster_block_exception', id: 7 }]));

    const result = await SegmentIndexer.bulkDelete([7]);

    expect(result).toMatchObject({ succeeded: 0, failed: 1 });
    expect(result.errors[0]).toMatchObject({ segmentId: 7 });
  });

  it('separates the two within one batch', async () => {
    esClient.bulk.mockResolvedValue(
      bulkDeleteResponse([
        { ok: true },
        { errorType: 'document_missing_exception', id: 8 },
        { errorType: 'boom', id: 9 },
      ]),
    );

    expect(await SegmentIndexer.bulkDelete([7, 8, 9])).toMatchObject({ succeeded: 2, failed: 1 });
  });
});

describe('reindex', () => {
  it('walks every segment when no media is named', async () => {
    await seedSegment();
    await seedSegment();
    esClient.bulk.mockResolvedValue(bulkOk(2));

    const result = await SegmentIndexer.reindex();

    expect(result.success).toBe(true);
    expect(result.stats).toMatchObject({ totalSegments: 2, successfulIndexes: 2, failedIndexes: 0 });
  });

  it('counts the media it touched', async () => {
    await seedSegment();
    esClient.bulk.mockResolvedValue(bulkOk(1));

    expect((await SegmentIndexer.reindex()).stats.mediaProcessed).toBe(1);
  });

  it('narrows to the media it was given', async () => {
    const { id: _id, ...clone } = await Media.findOneByOrFail({ id: mediaId });
    const other = await Media.save(
      Media.create({ ...clone, slug: 'indexer-other-show', publicId: 'IndexerOther' } as Media),
    );
    await seedEpisode(other.id, 1);
    await seedSegment();
    await seedSegment({ mediaId: other.id });
    esClient.bulk.mockResolvedValue(bulkOk(1));

    const result = await SegmentIndexer.reindex([{ mediaId: other.id }]);

    expect(result.stats.totalSegments).toBe(1);
    expect(result.stats.mediaProcessed).toBe(1);
  });

  it('narrows to named episodes within a media', async () => {
    await seedEpisode(mediaId, 2);
    await seedSegment({ episode: 1 });
    await seedSegment({ episode: 2 });
    esClient.bulk.mockResolvedValue(bulkOk(1));

    const result = await SegmentIndexer.reindex([{ mediaId, episodes: [2] }]);

    expect(result.stats.totalSegments).toBe(1);
  });

  it('counts a requested media even when it has no segments', async () => {
    // "I asked for three titles and it processed three" is what the operator
    // checks; a title that turned out to be empty is still one it looked at.
    esClient.bulk.mockResolvedValue(bulkOk(0));

    expect((await SegmentIndexer.reindex([{ mediaId }])).stats.mediaProcessed).toBe(1);
  });

  it('reports FAILURE when any document was rejected, even though the run finished', async () => {
    // The number an operator reads. A run that dropped documents but says
    // "completed" is one nobody looks at again.
    const segment = await seedSegment();
    esClient.bulk.mockResolvedValue(bulkWithIndexErrors([segment.id], 0));

    const result = await SegmentIndexer.reindex();

    expect(result.success).toBe(false);
    expect(result.message).toMatch(/failed/i);
    expect(result.errors).toHaveLength(1);
  });

  it('reports failure, with the stats it got to, when the index becomes unreachable', async () => {
    // A partial count is more use than none: it says how far the run got.
    await seedSegment();
    esClient.bulk.mockRejectedValue(new Error('connection refused'));

    const result = await SegmentIndexer.reindex();

    expect(result.success).toBe(false);
    expect(result.message).toBe('connection refused');
    expect(result.stats.totalSegments).toBe(1);
  });

  it('succeeds trivially on an empty corpus', async () => {
    const result = await SegmentIndexer.reindex();

    expect(result.success).toBe(true);
    expect(result.stats.totalSegments).toBe(0);
  });

  it('builds into the named index when one is given', async () => {
    await seedSegment();
    esClient.bulk.mockResolvedValue(bulkOk(1));

    await SegmentIndexer.reindex(undefined, 'nadedb_rebuild');

    const [action] = esClient.bulk.mock.calls[0]![0].operations;
    expect(action.index._index).toBe('nadedb_rebuild');
  });
});
