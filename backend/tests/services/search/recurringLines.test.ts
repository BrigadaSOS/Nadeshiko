import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { PgBoss } from 'pg-boss';
import { setupTestSuite } from '../../helpers/setup';
import { loadFixtures, type LoadedFixtures } from '../../fixtures/loader';
import { Episode } from '@app/models';
import { Segment, SegmentStatus } from '@app/models/Segment';
import { setBossInstance } from '@app/workers/pgBossClient';
import { recomputeRecurringRepeats, RECURRING_MIN_LONE_LENGTH } from '@app/services/search/recurringLines';

setupTestSuite();

let fixtures: LoadedFixtures;

const LONG_LINE = '次回予告のナレーションはこちらです、お楽しみに';

/** Saves one segment of the fixture title. Subscribers queue jobs against the mocked boss. */
async function line(episode: number, position: number, contentJa: string, status = SegmentStatus.ACTIVE) {
  return Object.assign(new Segment(), {
    uuid: `rec-${episode}-${position}-${Math.random()}`,
    position,
    status,
    startTimeMs: position * 1000,
    endTimeMs: position * 1000 + 900,
    contentJa,
    // Translations must be non-empty (a check constraint); their text is irrelevant to the rule.
    contentEs: 'línea',
    contentEn: 'line',
    contentEsMt: false,
    contentEnMt: false,
    contentRating: 'SAFE',
    ratingAnalysis: { scores: {}, tags: {} },
    storage: 'R2',
    hashedId: `rec-${episode}-${position}-${Math.random()}`,
    mediaId: fixtures.media.testShow.id,
    episode,
    storageBasePath: '/test',
    tokens: null,
  }).save();
}

/** Four episodes, each: an opening pair, a unique line, はい, another unique line; episodes 1-3 also end on the same
 * long narrated line, and episodes 1-2 share one ordinary line. */
async function seedTitle() {
  const media = fixtures.media.testShow;
  for (const episodeNumber of [1, 2, 3, 4]) {
    const exists = await Episode.findOneBy({ mediaId: media.id, episodeNumber });
    if (!exists) await Episode.create({ mediaId: media.id, episodeNumber, segmentCount: 0 }).save();
  }

  const rows: Record<string, Segment[]> = { opA: [], opB: [], hai: [], long: [], twice: [] };
  for (const ep of [1, 2, 3, 4]) {
    rows.opA!.push(await line(ep, 1, '燃えろ 燃えろ'));
    rows.opB!.push(await line(ep, 2, '今 飛び立とう'));
    await line(ep, 3, `第${ep}話の台詞`);
    rows.hai!.push(await line(ep, 4, 'はい'));
    await line(ep, 5, `別の台詞 ${ep}`);
    if (ep <= 3) rows.long!.push(await line(ep, 6, LONG_LINE));
    if (ep <= 2) rows.twice!.push(await line(ep, 7, 'また明日'));
  }
  return rows;
}

const flagOf = async (segment: Segment) => (await Segment.findOneByOrFail({ id: segment.id })).recurringRepeat;

beforeEach(async () => {
  fixtures = await loadFixtures(['mediaWithEpisode']);
  setBossInstance({
    insert: vi.fn().mockResolvedValue(['job']),
    send: vi.fn().mockResolvedValue('job'),
    sendDebounced: vi.fn().mockResolvedValue('job'),
  } as unknown as PgBoss);
});

describe('recomputeRecurringRepeats', () => {
  it('flags later copies of an opening sequence and of a long narrated line, never the first copy', async () => {
    expect(LONG_LINE.length).toBeGreaterThanOrEqual(RECURRING_MIN_LONE_LENGTH);
    const rows = await seedTitle();

    await recomputeRecurringRepeats(fixtures.media.testShow.id);

    for (const key of ['opA', 'opB', 'long'] as const) {
      const flags = await Promise.all(rows[key]!.map(flagOf));
      expect(flags[0], `${key}: the first episode's copy stays`).toBe(false);
      expect(flags.slice(1).every(Boolean), `${key}: later copies are repeats`).toBe(true);
    }
  });

  it('leaves an everyday line said at different moments, and a line in only two episodes, alone', async () => {
    const rows = await seedTitle();

    await recomputeRecurringRepeats(fixtures.media.testShow.id);

    expect(await Promise.all(rows.hai!.map(flagOf))).toEqual([false, false, false, false]);
    expect(await Promise.all(rows.twice!.map(flagOf))).toEqual([false, false]);
  });

  it('returns only the rows it changed, so a second run is a no-op', async () => {
    await seedTitle();
    const mediaId = fixtures.media.testShow.id;

    const first = await recomputeRecurringRepeats(mediaId);
    // Opening pair in episodes 2-4 (6) and the long line in episodes 2-3 (2).
    expect(first).toHaveLength(8);
    expect(await recomputeRecurringRepeats(mediaId)).toEqual([]);
  });

  it('follows the title when an episode goes away, and clears segments that are no longer active', async () => {
    const rows = await seedTitle();
    const mediaId = fixtures.media.testShow.id;
    await recomputeRecurringRepeats(mediaId);

    // Hide the long line's copies in episodes 1 and 2: it now recurs in one episode only.
    for (const segment of rows.long!.slice(0, 2)) {
      await Segment.update({ id: segment.id }, { status: SegmentStatus.DELETED });
    }
    const changed = await recomputeRecurringRepeats(mediaId);

    // The hidden episode-2 copy is cleared (not active), and the episode-3 copy is now the only one left.
    expect(changed).toContain(rows.long![1]!.id);
    expect(changed).toContain(rows.long![2]!.id);
    expect(await Promise.all(rows.long!.map(flagOf))).toEqual([false, false, false]);
  });
});
