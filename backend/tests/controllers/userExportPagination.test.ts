import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import * as schemas from 'generated/schemas';
import type { t_UserExportResponse } from 'generated/models';
import { request } from '../helpers/http';
import { assertMatchesSchema } from '../helpers/openapiContract';
import { createTestApp, setupTestSuite, signInAs, TestDataSource } from '../helpers/setup';
import { seedCoreFixtures, type CoreFixtures } from '../fixtures/core';
import { loadFixtures } from '../fixtures/loader';

const app = createTestApp();
const ACTIVITY_AT = '2026-01-01T00:00:00.000Z';
const REPORT_AT = '2026-01-01T00:00:00.000Z';

type SeededActivity = { id: number; search_query: string };
type SeededReport = { id: number; target_episode_number: number };

let core: CoreFixtures;

setupTestSuite();

beforeAll(async () => {
  core = await seedCoreFixtures();
});

beforeEach(() => {
  signInAs(app, core.users.kevin);
});

async function insertActivities(userId: number, count: number, at: string, marker: string) {
  return (await TestDataSource.query(
    `INSERT INTO "UserActivity" ("user_id", "activity_type", "search_query", "created_at")
     SELECT $1, 'SEARCH'::activity_type, $4 || '-' || gs::text, $2::timestamptz
     FROM generate_series(1, $3::int) AS gs
     RETURNING "id", "search_query"`,
    [userId, at, count, marker],
  )) as SeededActivity[];
}

async function insertReports(userId: number, mediaId: number, count: number, at: string, firstEpisode = 1) {
  await TestDataSource.query(
    `INSERT INTO "Episode" ("media_id", "episode_number", "title_english")
     SELECT $1, $2 + gs - 1, 'Export pagination episode ' || ($2 + gs - 1)::text
     FROM generate_series(1, $3::int) AS gs
     ON CONFLICT ("media_id", "episode_number") DO NOTHING`,
    [mediaId, firstEpisode, count],
  );

  return (await TestDataSource.query(
    `INSERT INTO "Report"
       ("source", "target_type", "target_media_id", "target_episode_number", "reason", "user_id", "created_at")
     SELECT 'USER'::report_source, 'EPISODE'::report_target_type, $1, $2 + gs - 1, 'OTHER'::report_reason, $3, $4::timestamptz
     FROM generate_series(1, $5::int) AS gs
     RETURNING "id", "target_episode_number"`,
    [mediaId, firstEpisode, userId, at, count],
  )) as SeededReport[];
}

async function createReportMedia() {
  const fixtures = await loadFixtures(['singleMedia']);
  return fixtures.media.testShow;
}

async function getExport(label: string) {
  const res = await request(app).get('/v1/user/export');
  expect(res.status).toBe(200);
  assertMatchesSchema(schemas.s_UserExportResponse, res.body, label);
  return res.body as t_UserExportResponse;
}

function descendingIds<T extends { id: number }>(rows: T[]) {
  return rows.map((row) => row.id).sort((a, b) => b - a);
}

function reportEpisodeNumbers(reports: t_UserExportResponse['reports']) {
  return reports.map(({ target }) => {
    if (target.type !== 'EPISODE') throw new Error(`Expected an EPISODE target, got ${target.type}`);
    return target.episodeNumber;
  });
}

describe('GET /v1/user/export activity and report pagination', () => {
  it('walks multiple pages and preserves id DESC ties at millisecond precision', async () => {
    const media = await createReportMedia();
    const activities = await insertActivities(core.users.kevin.id, 1_001, ACTIVITY_AT, 'tie-activity');
    const reports = await insertReports(core.users.kevin.id, media.id, 1_001, REPORT_AT);

    const body = await getExport('GET /v1/user/export multi-page ties');

    expect(body.activity.map((row) => row.id)).toEqual(descendingIds(activities));
    expect(body.activity.map((row) => row.searchQuery)).toEqual(
      activities
        .slice()
        .sort((a, b) => b.id - a.id)
        .map((row) => row.search_query),
    );
    expect(body.reports.map((row) => row.id)).toEqual(descendingIds(reports));
    expect(reportEpisodeNumbers(body.reports)).toEqual(
      reports
        .slice()
        .sort((a, b) => b.id - a.id)
        .map((row) => row.target_episode_number),
    );
    expect(body.truncated).toEqual({
      activity: false,
      collections: false,
      collectionSegments: false,
      reports: false,
      mediaAffinity: false,
    });
  });

  describe.each(['activity', 'reports'] as const)('%s microsecond pagination', (section) => {
    it.each([
      { name: 'equal timestamp ties', tailAt: '2026-01-01T00:00:00.123456Z' },
      { name: 'an older row in the same millisecond', tailAt: '2026-01-01T00:00:00.123200Z' },
    ])('keeps all rows across the page boundary with $name', async ({ tailAt }) => {
      const at = '2026-01-01T00:00:00.123456Z';
      // Also exercise timestamp text with a non-UTC offset; public timestamps must remain UTC ISO strings.
      await TestDataSource.query("SET LOCAL TIME ZONE 'Asia/Kolkata'");

      let expectedIds: number[];
      if (section === 'activity') {
        const head = await insertActivities(core.users.kevin.id, 1_000, at, 'precision-head');
        const tail = await insertActivities(core.users.kevin.id, 1, tailAt, 'precision-tail');
        expectedIds = tailAt === at ? descendingIds([...head, ...tail]) : [...descendingIds(head), tail[0].id];
      } else {
        const media = await createReportMedia();
        const head = await insertReports(core.users.kevin.id, media.id, 1_000, at);
        const tail = await insertReports(core.users.kevin.id, media.id, 1, tailAt, 1_001);
        expectedIds = tailAt === at ? descendingIds([...head, ...tail]) : [...descendingIds(head), tail[0].id];
      }

      const body = await getExport(`GET /v1/user/export ${section} microsecond boundary`);
      expect(body[section]).toHaveLength(1_001);
      expect(body[section].map((row) => row.id)).toEqual(expectedIds);
      expect(body[section].map((row) => row.createdAt)).toEqual(
        Array.from({ length: 1_001 }, () => '2026-01-01T00:00:00.123Z'),
      );
      expect(body.truncated).toEqual({
        activity: false,
        collections: false,
        collectionSegments: false,
        reports: false,
        mediaAffinity: false,
      });
    });
  });

  it('uses the date before id when newer rows have lower ids', async () => {
    const media = await createReportMedia();
    const [newActivity] = await insertActivities(core.users.kevin.id, 1, '2026-02-01T00:00:00.000Z', 'newer');
    const [oldActivity] = await insertActivities(core.users.kevin.id, 1, '2026-01-01T00:00:00.000Z', 'older');
    const [newReport] = await insertReports(core.users.kevin.id, media.id, 1, '2026-02-01T00:00:00.000Z');
    const [oldReport] = await insertReports(core.users.kevin.id, media.id, 1, '2026-01-01T00:00:00.000Z', 2);

    const body = await getExport('GET /v1/user/export date precedence');

    expect(newActivity.id).toBeLessThan(oldActivity.id);
    expect(newReport.id).toBeLessThan(oldReport.id);
    expect(body.activity.map((row) => row.id)).toEqual([newActivity.id, oldActivity.id]);
    expect(body.activity.map((row) => row.searchQuery)).toEqual(['newer-1', 'older-1']);
    expect(body.reports.map((row) => row.id)).toEqual([newReport.id, oldReport.id]);
    expect(reportEpisodeNumbers(body.reports)).toEqual([1, 2]);
  });

  it('filters both paged sections to the signed-in user across page two', async () => {
    const media = await createReportMedia();
    const ownActivities = await insertActivities(core.users.kevin.id, 1_001, ACTIVITY_AT, 'kevin');
    const ownReports = await insertReports(core.users.kevin.id, media.id, 1_001, REPORT_AT);
    await insertActivities(core.users.david.id, 1, '2025-01-01T00:00:00.000Z', 'david');
    await insertReports(core.users.david.id, media.id, 1, '2025-01-01T00:00:00.000Z');

    const body = await getExport('GET /v1/user/export user isolation across pages');

    expect(body.activity.map((row) => row.id)).toEqual(descendingIds(ownActivities));
    expect(body.activity.map((row) => row.searchQuery)).toEqual(
      ownActivities
        .slice()
        .sort((a, b) => b.id - a.id)
        .map((row) => row.search_query),
    );
    expect(body.reports.map((row) => row.id)).toEqual(descendingIds(ownReports));
    expect(body.reports.map((row) => row.userId)).toEqual(Array.from({ length: 1_001 }, () => core.users.kevin.id));
  });

  it.each([
    { name: 'cap minus one', count: 49_999, expectedCount: 49_999, truncated: false },
    { name: 'exact cap (conservative)', count: 50_000, expectedCount: 50_000, truncated: true },
    { name: 'over cap', count: 50_001, expectedCount: 50_000, truncated: true },
  ])('$name activity rows and reports the literal truncation flag', async ({ count, expectedCount, truncated }) => {
    const activities = await insertActivities(core.users.kevin.id, count, ACTIVITY_AT, 'activity-cap');

    const body = await getExport(`GET /v1/user/export activity ${count}`);

    expect(body.activity).toHaveLength(expectedCount);
    expect(body.activity.map((row) => row.id)).toEqual(descendingIds(activities).slice(0, expectedCount));
    expect(body.truncated).toEqual({
      activity: truncated,
      collections: false,
      collectionSegments: false,
      reports: false,
      mediaAffinity: false,
    });
  });

  it.each([
    { name: 'cap minus one', count: 4_999, expectedCount: 4_999, truncated: false },
    { name: 'exact cap (conservative)', count: 5_000, expectedCount: 5_000, truncated: true },
    { name: 'over cap', count: 5_001, expectedCount: 5_000, truncated: true },
  ])('$name report rows and reports the literal truncation flag', async ({ count, expectedCount, truncated }) => {
    const media = await createReportMedia();
    const reports = await insertReports(core.users.kevin.id, media.id, count, REPORT_AT);

    const body = await getExport(`GET /v1/user/export reports ${count}`);

    expect(body.reports).toHaveLength(expectedCount);
    expect(body.reports.map((row) => row.id)).toEqual(descendingIds(reports).slice(0, expectedCount));
    expect(body.truncated).toEqual({
      activity: false,
      collections: false,
      collectionSegments: false,
      reports: truncated,
      mediaAffinity: false,
    });
  });
});
