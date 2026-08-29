import { describe, it, expect, beforeEach } from 'vitest';
import { setupTestSuite } from '../../helpers/setup';
import { loadFixtures } from '../../fixtures/loader';
import { Media } from '@app/models';
import { Report, ReportReason, ReportSource, ReportStatus, ReportTargetType } from '@app/models/Report';
import {
  buildGroupRepresentativesQuery,
  deleteReportGroup,
  fetchGroupMembers,
  parseAndRequireBulkFilters,
  updateReportGroups,
} from '@app/services/reports/reportQueries';

/**
 * Reports are STORED per user and ADMINISTERED per target group -- the
 * (targetType, mediaId, episodeNumber, segmentId) tuple that several people may
 * each have reported separately. Almost everything in this module exists to
 * express "the same target" in SQL, and it is fiddly for one specific reason:
 * two of those four columns are nullable, and `= NULL` is never true.
 *
 * That is the failure this file is mostly about. A media-level group -- no
 * episode, no segment -- matched with `=` matches NOTHING, so resolving it
 * silently updates zero rows and reports success. The admin sees the report
 * still sitting there and files it again.
 *
 * The other half is the bulk guard. `parseAndRequireBulkFilters` refuses an
 * empty filter set because a bulk delete with no filters matches every report
 * in the table, and there is no undo for that.
 */
setupTestSuite();

let mediaId: number;
let otherMediaId: number;
let counter = 0;

/** One report against a target, defaulting to a media-level (null episode, null segment) one. */
async function seedReport(overrides: Partial<Report> = {}): Promise<Report> {
  counter += 1;
  return Report.save(
    Report.create({
      source: ReportSource.USER,
      targetType: ReportTargetType.MEDIA,
      targetMediaId: mediaId,
      targetEpisodeNumber: null,
      targetSegmentId: null,
      reason: ReportReason.OTHER,
      status: ReportStatus.OPEN,
      userId: null,
      description: `report-${counter}`,
      ...overrides,
    } as Report),
  );
}

/** The statuses currently stored, for asserting what an update actually moved. */
async function statuses(): Promise<Record<string, ReportStatus>> {
  const rows = await Report.find();
  return Object.fromEntries(rows.map((r) => [r.description ?? String(r.id), r.status]));
}

beforeEach(async () => {
  await Report.query('DELETE FROM "Report"');
  const fixtures = await loadFixtures(['mediaWithEpisode']);
  mediaId = fixtures.media.testShow!.id;

  // A second title, because "a group never crosses into another one" cannot be
  // asserted with only one. Cloned rather than loaded from a second fixture
  // set: every set in the catalog names its media `testShow`, and the loader
  // refuses two sets that collide on a key.
  const { id: _id, ...clone } = fixtures.media.testShow!;
  otherMediaId = (
    await Media.save(
      Media.create({ ...clone, slug: 'report-queries-other-show', publicId: 'ReportQueriesOther' } as Media),
    )
  ).id;
});

describe('target groups with null columns', () => {
  it('a media-level group matches its own reports', async () => {
    // `target_episode_number = NULL` matches no rows, so this whole feature is
    // one `IS NULL` away from silently doing nothing at media level.
    const rep = await seedReport();
    await seedReport();

    const updated = await updateReportGroups([rep], { status: ReportStatus.FIXED });

    expect(updated).toBe(2);
    expect(Object.values(await statuses())).toEqual([ReportStatus.FIXED, ReportStatus.FIXED]);
  });

  it('an episode-level group does not sweep up the media-level reports', async () => {
    // They are different targets: "this episode is wrong" and "this show is
    // wrong" are separate complaints with separate fixes.
    const episodeReport = await seedReport({ targetType: ReportTargetType.EPISODE, targetEpisodeNumber: 1 });
    await seedReport({ description: 'media-level' });

    await updateReportGroups([episodeReport], { status: ReportStatus.FIXED });

    const after = await statuses();
    expect(after['media-level']).toBe(ReportStatus.OPEN);
  });

  it('a media-level group does not sweep up the episode-level reports either', async () => {
    const mediaReport = await seedReport({ description: 'media-level' });
    await seedReport({ description: 'episode-level', targetType: ReportTargetType.EPISODE, targetEpisodeNumber: 1 });

    await updateReportGroups([mediaReport], { status: ReportStatus.FIXED });

    const after = await statuses();
    expect(after['episode-level']).toBe(ReportStatus.OPEN);
  });

  it('a segment-level group matches only that segment', async () => {
    const first = await seedReport({
      description: 'seg-1',
      targetType: ReportTargetType.SEGMENT,
      targetEpisodeNumber: 1,
      targetSegmentId: 111,
    });
    await seedReport({
      description: 'seg-2',
      targetType: ReportTargetType.SEGMENT,
      targetEpisodeNumber: 1,
      targetSegmentId: 222,
    });

    await updateReportGroups([first], { status: ReportStatus.FIXED });

    const after = await statuses();
    expect(after['seg-1']).toBe(ReportStatus.FIXED);
    expect(after['seg-2']).toBe(ReportStatus.OPEN);
  });

  it('a group never crosses into another title', async () => {
    const mine = await seedReport({ description: 'mine' });
    await seedReport({ description: 'theirs', targetMediaId: otherMediaId });

    await updateReportGroups([mine], { status: ReportStatus.FIXED });

    expect((await statuses())['theirs']).toBe(ReportStatus.OPEN);
  });
});

describe('updateReportGroups', () => {
  it('updates nothing, and says so, for an empty list', async () => {
    await seedReport();

    expect(await updateReportGroups([], { status: ReportStatus.FIXED })).toBe(0);
    expect(Object.values(await statuses())).toEqual([ReportStatus.OPEN]);
  });

  it('counts each report moved, not each group', async () => {
    // The admin UI shows "resolved 7 reports", which is a number of rows.
    const rep = await seedReport();
    await seedReport();
    await seedReport();

    expect(await updateReportGroups([rep], { status: ReportStatus.FIXED })).toBe(3);
  });

  it('does not update a group twice when two of its reports are passed', async () => {
    // The admin selects rows, and several rows can belong to one group. Running
    // the same statement twice would double the count the UI reports.
    const first = await seedReport();
    const second = await seedReport();

    expect(await updateReportGroups([first, second], { status: ReportStatus.FIXED })).toBe(2);
  });

  it('handles several distinct groups in one call', async () => {
    const mediaLevel = await seedReport({ description: 'a' });
    const episodeLevel = await seedReport({
      description: 'b',
      targetType: ReportTargetType.EPISODE,
      targetEpisodeNumber: 1,
    });

    const updated = await updateReportGroups([mediaLevel, episodeLevel], { status: ReportStatus.FIXED });

    expect(updated).toBe(2);
    expect(Object.values(await statuses())).toEqual([ReportStatus.FIXED, ReportStatus.FIXED]);
  });

  it('applies the whole patch, not only the status', async () => {
    const rep = await seedReport();

    await updateReportGroups([rep], { status: ReportStatus.DISMISSED, adminNotes: 'not a bug' });

    const [row] = await Report.find();
    expect(row).toMatchObject({ status: ReportStatus.DISMISSED, adminNotes: 'not a bug' });
  });
});

describe('deleteReportGroup', () => {
  it('deletes every report in the group', async () => {
    const rep = await seedReport();
    await seedReport();

    expect(await deleteReportGroup(rep)).toBe(2);
    expect(await Report.count()).toBe(0);
  });

  it('leaves other groups standing', async () => {
    const rep = await seedReport();
    await seedReport({ description: 'other', targetType: ReportTargetType.EPISODE, targetEpisodeNumber: 1 });

    await deleteReportGroup(rep);

    expect((await Report.find()).map((r) => r.description)).toEqual(['other']);
  });

  it('matches a media-level group, which is the one `= NULL` would miss', async () => {
    const rep = await seedReport({ targetEpisodeNumber: null, targetSegmentId: null });

    expect(await deleteReportGroup(rep)).toBe(1);
  });
});

describe('fetchGroupMembers', () => {
  it('returns nothing for no representatives, without querying', async () => {
    await seedReport();

    expect(await fetchGroupMembers([], {})).toEqual([]);
  });

  it('returns every report in a representative’s group', async () => {
    const rep = await seedReport();
    await seedReport();

    expect(await fetchGroupMembers([rep], {})).toHaveLength(2);
  });

  it('returns the members of several groups at once', async () => {
    // The admin list shows one row per group and expands to its members, so
    // this is one query for the whole page rather than one per row.
    const mediaLevel = await seedReport();
    const episodeLevel = await seedReport({ targetType: ReportTargetType.EPISODE, targetEpisodeNumber: 1 });
    await seedReport({ targetMediaId: otherMediaId });

    const members = await fetchGroupMembers([mediaLevel, episodeLevel], {});

    expect(members).toHaveLength(2);
  });

  it('still applies the list filters', async () => {
    // The expanded members have to agree with the filter the list was drawn
    // under, or resolving from the list touches rows the admin never saw.
    const rep = await seedReport();
    await seedReport({ description: 'dismissed', status: ReportStatus.DISMISSED });

    const members = await fetchGroupMembers([rep], { statuses: [ReportStatus.OPEN] });

    expect(members.map((m) => m.description)).toEqual([expect.stringMatching(/^report-/)]);
  });
});

describe('buildGroupRepresentativesQuery', () => {
  it('returns one row per target group, not one per report', async () => {
    // The admin list is a list of groups; three people reporting the same show
    // is one thing to act on.
    await seedReport();
    await seedReport();
    await seedReport();

    expect(await buildGroupRepresentativesQuery({}).getCount()).toBe(1);
  });

  it('separates groups that differ only in their episode', async () => {
    await seedReport({ targetType: ReportTargetType.EPISODE, targetEpisodeNumber: 1 });
    await seedReport({ targetType: ReportTargetType.EPISODE, targetEpisodeNumber: 2 });

    expect(await buildGroupRepresentativesQuery({}).getCount()).toBe(2);
  });

  it('separates a media-level group from an episode-level one', async () => {
    await seedReport();
    await seedReport({ targetType: ReportTargetType.EPISODE, targetEpisodeNumber: 1 });

    expect(await buildGroupRepresentativesQuery({}).getCount()).toBe(2);
  });

  it('filters by status', async () => {
    await seedReport();
    await seedReport({ targetMediaId: otherMediaId, status: ReportStatus.FIXED });

    const rows = await buildGroupRepresentativesQuery({ statuses: [ReportStatus.FIXED] }).getMany();

    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe(ReportStatus.FIXED);
  });

  it('filters by source', async () => {
    await seedReport();
    await seedReport({ targetMediaId: otherMediaId, source: ReportSource.AUTO });

    const rows = await buildGroupRepresentativesQuery({ source: ReportSource.AUTO }).getMany();

    expect(rows).toHaveLength(1);
  });

  it('filters by target type', async () => {
    await seedReport();
    await seedReport({ targetType: ReportTargetType.EPISODE, targetEpisodeNumber: 1 });

    const rows = await buildGroupRepresentativesQuery({ targetType: ReportTargetType.EPISODE }).getMany();

    expect(rows).toHaveLength(1);
  });

  it('filters by media', async () => {
    await seedReport();
    await seedReport({ targetMediaId: otherMediaId });

    const rows = await buildGroupRepresentativesQuery({ targetMediaId: otherMediaId }).getMany();

    expect(rows).toHaveLength(1);
    expect(rows[0]?.targetMediaId).toBe(otherMediaId);
  });

  it('applies the filter to the dedup subquery too, not only the outer query', async () => {
    // The representative of a group is `MAX(id)` over the group. If the filter
    // were applied only outside, a group whose newest report is REJECTED would
    // pick that row as its representative and then be filtered away entirely --
    // so a group with open reports in it would vanish from the open list.
    await seedReport({ description: 'open-older' });
    await seedReport({ description: 'dismissed-newer', status: ReportStatus.DISMISSED });

    const rows = await buildGroupRepresentativesQuery({ statuses: [ReportStatus.OPEN] }).getMany();

    expect(rows.map((r) => r.description)).toEqual(['open-older']);
  });

  it('finds groups whose media no longer exists', async () => {
    // The orphan filter is how a report about a deleted title is cleared out;
    // nothing else on the admin screen can reach it.
    await seedReport();
    await seedReport({ targetMediaId: 99_999_999, description: 'orphan' });

    const rows = await buildGroupRepresentativesQuery({ orphaned: true }).getMany();

    expect(rows.map((r) => r.description)).toEqual(['orphan']);
  });
});

describe('parseAndRequireBulkFilters', () => {
  it('refuses an empty filter set', async () => {
    // A bulk delete with no filters matches every report in the table, and
    // there is no undo.
    expect(() => parseAndRequireBulkFilters({})).toThrow(/At least one filter/);
  });

  it('refuses a missing filter set', async () => {
    expect(() => parseAndRequireBulkFilters(undefined)).toThrow(/At least one filter/);
  });

  it.each([
    ['status', { status: 'OPEN' }],
    ['source', { source: 'USER' }],
    ['targetType', { targetType: 'MEDIA' }],
    ['targetMediaId', { targetMediaId: 1 }],
    ['targetEpisodeNumber', { targetEpisodeNumber: 1 }],
    ['targetSegmentId', { targetSegmentId: 1 }],
    ['orphaned', { orphaned: true }],
  ])('accepts a set filtered only by %s', (_name, input) => {
    expect(() => parseAndRequireBulkFilters(input)).not.toThrow();
  });

  it('treats a zero id as a filter, not as absent', async () => {
    // `filters.targetMediaId !== undefined` rather than a truthiness check: a
    // falsy-but-present id read as "no filter" is the whole table.
    expect(() => parseAndRequireBulkFilters({ targetMediaId: 0 })).not.toThrow();
    expect(() => parseAndRequireBulkFilters({ targetEpisodeNumber: 0 })).not.toThrow();
  });

  it('refuses `orphaned: false`, which selects nothing in particular', async () => {
    // Unlike an id, `false` here is not a narrowing -- it is the absence of the
    // orphan filter, and on its own it would match the whole table.
    expect(() => parseAndRequireBulkFilters({ orphaned: false })).toThrow(/At least one filter/);
  });

  it('passes the parsed filters through for the query to use', async () => {
    const parsed = parseAndRequireBulkFilters({ status: 'OPEN', targetMediaId: 7 });

    expect(parsed).toMatchObject({ targetMediaId: 7 });
    expect(parsed.statuses).toBeDefined();
  });
});
