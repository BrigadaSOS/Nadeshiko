import { request } from '../helpers/http';
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { setupTestSuite, createTestApp, signInAs } from '../helpers/setup';
import { seedCoreFixtures, type CoreFixtures } from '../fixtures/core';
import { loadFixtures } from '../fixtures/loader';
import { setBossInstance } from '@app/workers/pgBossClient';
import { TOKEN_PARSE_QUEUE } from '@app/workers/queueNames';
import { ContentRating, Segment, SegmentStatus, SegmentStorage } from '@app/models/Segment';
import { SegmentRevision } from '@app/models/SegmentRevision';
import { Episode } from '@app/models';

/**
 * Restoring a revision, and moderating a whole episode.
 *
 * Both carry invariants the controller states outright, and both are the kind
 * that nothing else can catch:
 *
 * RESTORING IS APPEND-ONLY. Going back to revision 3 from revision 7 writes
 * revision 8 holding what 7 left behind. Rewinding the counter instead would
 * destroy the record of the edits being undone -- which is precisely the set of
 * rows anyone would want when working out why a bad edit happened, and the
 * restore itself would stop being undoable.
 *
 * EPISODE MODERATION IS ALL OR NOTHING. The count is checked against
 * `maxAffected` BEFORE any write, so a caller who guessed the episode size wrong
 * gets a refusal rather than a half-shifted episode. And it writes through
 * entities rather than a set-based UPDATE, because the Elasticsearch reindex
 * rides on the `afterUpdate` subscriber -- a faster UPDATE would leave search
 * serving the old timings for the whole episode, which is the defect the feature
 * was built to fix.
 */
setupTestSuite();

const app = createTestApp();

let core: CoreFixtures;
let mediaId: number;
let mediaPublicId: string;
let counter = 0;

const bossSendDebounced = vi.fn(async () => 'test-job-id');
const bossInsert = vi.fn(async () => ['test-job-id']);

async function seedSegment(overrides: Partial<Segment> = {}): Promise<Segment> {
  counter += 1;
  return Segment.save({
    uuid: `mod-seg-${counter}`,
    publicId: `mod${String(counter).padStart(9, '0')}`,
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
    hashedId: `mod-hash-${counter}`,
    storageBasePath: '/test',
    mediaId,
    episode: 1,
    ...overrides,
  }) as Promise<Segment>;
}

/**
 * Edits a segment's Japanese through the API, which is what writes a revision.
 * The request shape is the DTO's (`textJa.content`), not the column's.
 */
async function editJapanese(publicId: string, content: string) {
  return request(app).patch(`/v1/media/segments/${publicId}`).send({ textJa: { content } });
}

/** Edits only the English, leaving the Japanese -- and so the tokens -- alone. */
async function editEnglish(publicId: string, content: string) {
  return request(app).patch(`/v1/media/segments/${publicId}`).send({ textEn: { content } });
}

/**
 * The segment ids enqueued on one queue. `sendDebounced` carries both the
 * token-parse and the ES-sync work, so an unfiltered assertion on it would pass
 * on the reindex that every write triggers.
 */
function enqueuedOn(queue: string): number[] {
  return bossSendDebounced.mock.calls
    .filter(([name]: unknown[]) => name === queue)
    .map(([, data]: unknown[]) => (data as { segmentId: number }).segmentId);
}

/** Revision numbers stored for a segment, in order. */
async function revisionNumbers(segmentId: number): Promise<number[]> {
  const rows = await SegmentRevision.find({ where: { segmentId }, order: { revisionNumber: 'ASC' } });
  return rows.map((r) => r.revisionNumber);
}

beforeAll(async () => {
  setBossInstance({ sendDebounced: bossSendDebounced, insert: bossInsert } as never);
  core = await seedCoreFixtures();
});

beforeEach(async () => {
  vi.clearAllMocks();
  signInAs(app, core.users.kevin);
  await SegmentRevision.query('DELETE FROM "SegmentRevision"');
  await Segment.query('DELETE FROM "Segment"');
  const fixtures = await loadFixtures(['mediaWithEpisode']);
  mediaId = fixtures.media.testShow!.id;
  mediaPublicId = fixtures.media.testShow!.publicId;
});

describe('restoring a revision', () => {
  it('puts the earlier content back', async () => {
    const segment = await seedSegment({ contentJa: 'original' });
    await editJapanese(segment.publicId, 'second');

    const res = await request(app).post(`/v1/media/segments/${segment.publicId}/revisions/1/restore`).send({});

    expect(res.status).toBe(200);
    expect((await Segment.findOneByOrFail({ id: segment.id })).contentJa).toBe('original');
  });

  it('writes a NEW revision rather than rewinding the counter', async () => {
    // Rewinding would destroy the record of the edits being undone, which is
    // exactly the set of rows anyone wants when working out what happened.
    const segment = await seedSegment({ contentJa: 'v1' });
    await editJapanese(segment.publicId, 'v2');
    await editJapanese(segment.publicId, 'v3');

    await request(app).post(`/v1/media/segments/${segment.publicId}/revisions/1/restore`).send({});

    expect(await revisionNumbers(segment.id)).toEqual([1, 2, 3]);
  });

  it('the new revision holds what the restore replaced, so it is itself undoable', async () => {
    const segment = await seedSegment({ contentJa: 'v1' });
    await editJapanese(segment.publicId, 'v2');

    await request(app).post(`/v1/media/segments/${segment.publicId}/revisions/1/restore`).send({});

    const latest = await SegmentRevision.findOneByOrFail({ segmentId: segment.id, revisionNumber: 2 });
    expect(latest.snapshot).toMatchObject({ contentJa: 'v2' });
  });

  it('a restore can itself be undone', async () => {
    // The property the two above add up to, asserted end to end.
    const segment = await seedSegment({ contentJa: 'v1' });
    await editJapanese(segment.publicId, 'v2');
    await request(app).post(`/v1/media/segments/${segment.publicId}/revisions/1/restore`).send({});

    await request(app).post(`/v1/media/segments/${segment.publicId}/revisions/2/restore`).send({});

    expect((await Segment.findOneByOrFail({ id: segment.id })).contentJa).toBe('v2');
  });

  it('404s a revision that does not exist', async () => {
    const segment = await seedSegment();

    const res = await request(app).post(`/v1/media/segments/${segment.publicId}/revisions/99/restore`).send({});

    expect(res.status).toBe(404);
  });

  it('writes no revision when the restore was refused', async () => {
    // A failed restore that still bumped the history would leave a revision
    // recording a change nobody made.
    const segment = await seedSegment();

    await request(app).post(`/v1/media/segments/${segment.publicId}/revisions/99/restore`).send({});

    expect(await revisionNumbers(segment.id)).toEqual([]);
  });

  it('re-parses the tokens when the restore moved the Japanese', async () => {
    // A snapshot carries the sentence but never its analysis, so a restore that
    // changes the text needs the same treatment as an edit that does --
    // otherwise the stored tokens describe a sentence that is no longer there.
    const segment = await seedSegment({ contentJa: 'original' });
    await editJapanese(segment.publicId, 'changed');
    vi.clearAllMocks();

    await request(app).post(`/v1/media/segments/${segment.publicId}/revisions/1/restore`).send({});

    expect(enqueuedOn(TOKEN_PARSE_QUEUE)).toContain(segment.id);
  });

  it('does not re-parse when the Japanese is unchanged', async () => {
    // Re-parsing every restore would queue work for a sentence whose analysis
    // is already correct.
    const segment = await seedSegment({ contentJa: 'same' });
    await editEnglish(segment.publicId, 'different english');
    vi.clearAllMocks();

    await request(app).post(`/v1/media/segments/${segment.publicId}/revisions/1/restore`).send({});

    expect(enqueuedOn(TOKEN_PARSE_QUEUE)).toEqual([]);
  });
});

describe('moderating an episode', () => {
  const moderateUrl = () => `/v1/media/${mediaPublicId}/episodes/1/segments/moderate`;

  it('shifts every segment in the episode', async () => {
    const a = await seedSegment({ startTimeMs: 1000, endTimeMs: 2000 });
    const b = await seedSegment({ startTimeMs: 3000, endTimeMs: 4000 });

    const res = await request(app).post(moderateUrl()).send({ action: 'shiftTimings', offsetMs: 500, maxAffected: 10 });

    expect(res.status).toBe(200);
    expect(await Segment.findOneByOrFail({ id: a.id })).toMatchObject({ startTimeMs: 1500, endTimeMs: 2500 });
    expect(await Segment.findOneByOrFail({ id: b.id })).toMatchObject({ startTimeMs: 3500, endTimeMs: 4500 });
  });

  it('reports how many segments it moved', async () => {
    await seedSegment();
    await seedSegment();

    const res = await request(app).post(moderateUrl()).send({ action: 'shiftTimings', offsetMs: 100, maxAffected: 10 });

    expect(res.body).toMatchObject({ count: 2 });
  });

  it('shifts backwards too', async () => {
    const segment = await seedSegment({ startTimeMs: 5000, endTimeMs: 6000 });

    await request(app).post(moderateUrl()).send({ action: 'shiftTimings', offsetMs: -1000, maxAffected: 10 });

    expect(await Segment.findOneByOrFail({ id: segment.id })).toMatchObject({ startTimeMs: 4000, endTimeMs: 5000 });
  });

  it('CLAMPS at zero rather than skipping a segment pushed below it', async () => {
    // A segment pushed below zero still belongs to the episode. Dropping it
    // from the shift would leave one line misaligned against every other one --
    // a worse defect than a slightly early clip.
    const early = await seedSegment({ startTimeMs: 200, endTimeMs: 900 });
    const later = await seedSegment({ startTimeMs: 5000, endTimeMs: 6000 });

    await request(app).post(moderateUrl()).send({ action: 'shiftTimings', offsetMs: -1000, maxAffected: 10 });

    expect(await Segment.findOneByOrFail({ id: early.id })).toMatchObject({ startTimeMs: 0, endTimeMs: 0 });
    expect(await Segment.findOneByOrFail({ id: later.id })).toMatchObject({ startTimeMs: 4000 });
  });

  it('changes the status of every segment when asked to', async () => {
    const segment = await seedSegment();

    await request(app).post(moderateUrl()).send({ action: 'setStatus', status: 'HIDDEN', maxAffected: 10 });

    expect((await Segment.findOneByOrFail({ id: segment.id })).status).toBe(SegmentStatus.HIDDEN);
  });

  it('REFUSES when the episode is bigger than the cap, before writing anything', async () => {
    // The caller guessed the size wrong. Applying to an arbitrary prefix would
    // leave a half-shifted episode with no record of where it stopped.
    const a = await seedSegment({ startTimeMs: 1000 });
    await seedSegment({ startTimeMs: 2000 });

    const res = await request(app).post(moderateUrl()).send({ action: 'shiftTimings', offsetMs: 500, maxAffected: 1 });

    expect(res.status).toBe(400);
    expect((await Segment.findOneByOrFail({ id: a.id })).startTimeMs).toBe(1000);
  });

  it('says how big the episode actually is, so the caller can raise the cap deliberately', async () => {
    await seedSegment();
    await seedSegment();

    const res = await request(app).post(moderateUrl()).send({ action: 'shiftTimings', offsetMs: 500, maxAffected: 1 });

    expect(JSON.stringify(res.body)).toMatch(/2 segments/);
  });

  it('writes no revisions when the cap refused the request', async () => {
    const segment = await seedSegment();
    await seedSegment();

    await request(app).post(moderateUrl()).send({ action: 'shiftTimings', offsetMs: 500, maxAffected: 1 });

    expect(await revisionNumbers(segment.id)).toEqual([]);
  });

  it('accepts an episode exactly at the cap', async () => {
    await seedSegment();
    await seedSegment();

    const res = await request(app).post(moderateUrl()).send({ action: 'shiftTimings', offsetMs: 500, maxAffected: 2 });

    expect(res.status).toBe(200);
  });

  it('writes ONE revision per segment, so a bulk change is revertible line by line', async () => {
    // Bulk here is a convenience over the same per-segment history the
    // single-segment path writes, not a second write path that bypasses it.
    const a = await seedSegment();
    const b = await seedSegment();

    await request(app).post(moderateUrl()).send({ action: 'shiftTimings', offsetMs: 500, maxAffected: 10 });

    expect(await revisionNumbers(a.id)).toEqual([1]);
    expect(await revisionNumbers(b.id)).toEqual([1]);
  });

  it('each revision holds that segment’s own previous timings', async () => {
    const a = await seedSegment({ startTimeMs: 1000 });
    await seedSegment({ startTimeMs: 7000 });

    await request(app).post(moderateUrl()).send({ action: 'shiftTimings', offsetMs: 500, maxAffected: 10 });

    const revision = await SegmentRevision.findOneByOrFail({ segmentId: a.id, revisionNumber: 1 });
    expect(revision.snapshot).toMatchObject({ startTimeMs: 1000 });
  });

  it('404s an episode with no segments in it', async () => {
    const res = await request(app)
      .post(`/v1/media/${mediaPublicId}/episodes/9/segments/moderate`)
      .send({ action: 'shiftTimings', offsetMs: 500, maxAffected: 10 });

    expect(res.status).toBe(404);
  });

  it('leaves the other episodes of the same title alone', async () => {
    await Episode.save(Episode.create({ mediaId, episodeNumber: 3, titleEn: 'Third', segmentCount: 0 } as never));
    const inEpisodeOne = await seedSegment({ startTimeMs: 1000 });
    const inEpisodeThree = await seedSegment({ episode: 3, startTimeMs: 1000 });

    await request(app).post(moderateUrl()).send({ action: 'shiftTimings', offsetMs: 500, maxAffected: 10 });

    expect((await Segment.findOneByOrFail({ id: inEpisodeOne.id })).startTimeMs).toBe(1500);
    expect((await Segment.findOneByOrFail({ id: inEpisodeThree.id })).startTimeMs).toBe(1000);
  });
});
