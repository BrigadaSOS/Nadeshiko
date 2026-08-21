import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Job, PgBoss } from 'pg-boss';
import { setupTestSuite } from '../helpers/setup';
import { loadFixtures, type LoadedFixtures } from '../fixtures/loader';
import { Segment, SegmentStatus, type SlimToken } from '@app/models/Segment';
import { setBossInstance } from '@app/workers/pgBossClient';
import { registerTokenParseWorker } from '@app/workers/tokenParseWorker';
import { TOKEN_PARSE_QUEUE, TOKEN_SWEEP_QUEUE } from '@app/workers/queueNames';
import { parseSegments } from '@app/services/shirabe/parseSegments';

vi.mock('@app/services/shirabe/parseSegments', () => ({
  parseSegments: vi.fn(),
}));

setupTestSuite();

const parseSegmentsMock = vi.mocked(parseSegments);

let fixtures: LoadedFixtures;
let insert: ReturnType<typeof vi.fn>;
let sendDebounced: ReturnType<typeof vi.fn>;
let handlers: Record<string, (jobs: Job<any>[]) => Promise<void>>;

function tokensFor(surface: string): SlimToken[] {
  return [{ s: surface, d: surface, r: surface, b: 0, e: surface.length, p: '名詞' }];
}

/**
 * Registers the worker against a fake boss and keeps the handlers it hands over.
 *
 * Going through `registerTokenParseWorker` rather than exporting the handlers
 * means the queue names, the pull size and the instrumentation wrapper are all
 * part of what is under test — a handler wired to the wrong queue would still
 * pass a test that called it directly.
 */
async function captureHandlers(): Promise<void> {
  handlers = {};
  const work = vi.fn(async (queue: string, ...rest: unknown[]) => {
    handlers[queue] = rest[rest.length - 1] as (jobs: Job<any>[]) => Promise<void>;
    return queue;
  });

  await registerTokenParseWorker({ work } as unknown as PgBoss);
}

async function buildSegment(overrides: Partial<Segment> = {}): Promise<Segment> {
  const media = fixtures.media.testShow;
  const episode = fixtures.episodes.pilot;

  return Object.assign(new Segment(), {
    uuid: `test-${Date.now()}-${Math.random()}`,
    position: 1,
    status: SegmentStatus.ACTIVE,
    startTimeMs: 0,
    endTimeMs: 5000,
    contentJa: 'テスト',
    contentEs: 'Prueba',
    contentEn: 'Test',
    contentEsMt: false,
    contentEnMt: false,
    contentRating: 'SAFE',
    ratingAnalysis: { scores: {}, tags: {} },
    storage: 'R2',
    hashedId: `hashed-${Date.now()}-${Math.random()}`,
    mediaId: media.id,
    episode: episode.episodeNumber,
    storageBasePath: '/test',
    tokens: null,
    ...overrides,
  }).save();
}

beforeEach(async () => {
  fixtures = await loadFixtures(['mediaWithEpisode']);
  insert = vi.fn().mockResolvedValue(['job-id']);
  sendDebounced = vi.fn().mockResolvedValue('job-id');
  setBossInstance({ insert, sendDebounced } as any);
  parseSegmentsMock.mockReset();
  await captureHandlers();
});

describe('token parse worker', () => {
  it('writes the analysis Shirabe returns and asks for a reindex', async () => {
    const segment = await buildSegment({ contentJa: '走る' });
    parseSegmentsMock.mockResolvedValue([tokensFor('走る')]);

    await handlers[TOKEN_PARSE_QUEUE]([{ data: { segmentId: segment.id } } as Job<any>]);

    expect(parseSegmentsMock).toHaveBeenCalledWith(['走る']);

    const reloaded = await Segment.findOneByOrFail({ id: segment.id });
    expect(reloaded.tokens).toEqual(tokensFor('走る'));

    // The UPDATE is a raw statement, so no subscriber fires — the worker owning
    // the reindex is what keeps this path from needing a second command.
    expect(insert).toHaveBeenCalledWith('es-sync-update', [{ data: { segmentId: segment.id, operation: 'UPDATE' } }]);
  });

  it('refuses to write an analysis of a sentence that has since been edited', async () => {
    const segment = await buildSegment({ contentJa: '走る' });

    // Shirabe answers for the text the worker read, and the row moves while it
    // was answering. Writing here would leave `b`/`e` offsets pointing into a
    // string nobody holds any more.
    parseSegmentsMock.mockImplementation(async () => {
      await Segment.update({ id: segment.id }, { contentJa: '歩く' });
      return [tokensFor('走る')];
    });

    await handlers[TOKEN_PARSE_QUEUE]([{ data: { segmentId: segment.id } } as Job<any>]);

    const reloaded = await Segment.findOneByOrFail({ id: segment.id });
    expect(reloaded.contentJa).toBe('歩く');
    expect(reloaded.tokens).toBeNull();
    expect(insert).not.toHaveBeenCalled();
  });

  it('parses a whole pull in one Shirabe call and skips ids that no longer exist', async () => {
    const first = await buildSegment({ contentJa: '朝', position: 1 });
    const second = await buildSegment({ contentJa: '夜', position: 2 });
    parseSegmentsMock.mockResolvedValue([tokensFor('朝'), tokensFor('夜')]);

    await handlers[TOKEN_PARSE_QUEUE]([
      { data: { segmentId: first.id } },
      { data: { segmentId: second.id } },
      { data: { segmentId: 999_999_999 } },
    ] as Job<any>[]);

    expect(parseSegmentsMock).toHaveBeenCalledTimes(1);
    expect(parseSegmentsMock).toHaveBeenCalledWith(['朝', '夜']);

    expect((await Segment.findOneByOrFail({ id: first.id })).tokens).toEqual(tokensFor('朝'));
    expect((await Segment.findOneByOrFail({ id: second.id })).tokens).toEqual(tokensFor('夜'));
  });

  it('does not call Shirabe when every id in the pull is gone', async () => {
    await handlers[TOKEN_PARSE_QUEUE]([{ data: { segmentId: 999_999_999 } } as Job<any>]);

    expect(parseSegmentsMock).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
  });

  it('sweeps untokenized segments and leaves the tokenized and the deleted alone', async () => {
    const untokenized = await buildSegment({ contentJa: '未', position: 1 });
    const alreadyParsed = await buildSegment({ contentJa: '済', position: 2, tokens: tokensFor('済') });
    const deleted = await buildSegment({ contentJa: '消', position: 3, status: SegmentStatus.DELETED });

    await handlers[TOKEN_SWEEP_QUEUE]([]);

    const enqueued: number[] = insert.mock.calls
      .filter(([queue]) => queue === TOKEN_PARSE_QUEUE)
      .flatMap(([, jobs]) => jobs.map((job: { data: { segmentId: number } }) => job.data.segmentId));

    expect(enqueued).toContain(untokenized.id);
    expect(enqueued).not.toContain(alreadyParsed.id);
    // Not served and not indexed, so parsing it spends Shirabe's CPU on text no
    // reader can reach.
    expect(enqueued).not.toContain(deleted.id);
  });

  it('enqueues nothing when the corpus is fully parsed', async () => {
    await buildSegment({ contentJa: '済', tokens: tokensFor('済') });

    await handlers[TOKEN_SWEEP_QUEUE]([]);

    expect(insert).not.toHaveBeenCalled();
  });
});
