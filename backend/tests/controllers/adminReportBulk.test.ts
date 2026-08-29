import { request } from '../helpers/http';
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import type { Application, Request, Response, NextFunction } from 'express';
import { buildApplication } from '@config/application';
import { AdminRoutes } from '@config/routes';
import { setupTestSuite } from '../helpers/setup';
import { seedCoreFixtures, type CoreFixtures } from '../fixtures/core';
import { loadFixtures } from '../fixtures/loader';
import { Media } from '@app/models';
import { Report, ReportReason, ReportSource, ReportStatus, ReportTargetType } from '@app/models/Report';
import { AuthType, ApiKeyKind, ApiPermission } from '@app/models/ApiPermission';

/**
 * The admin batch and bulk report endpoints.
 *
 * These are the destructive ones, and the property worth pinning is the same on
 * all four: what a request MATCHES. `DELETE /v1/admin/reports/bulk` takes a
 * filter set and deletes everything it selects, so a filter that is silently
 * dropped -- or a filter set that is silently empty -- takes the whole table
 * with it, and there is no undo.
 *
 * The other half is group propagation. Reports are administered per target
 * group, so resolving one report has to move its siblings; the admin acts on a
 * list of groups and expects the group to disappear, not one row of it.
 */
setupTestSuite();

let app: Application;
let core: CoreFixtures;
let mediaId: number;
let otherMediaId: number;
let counter = 0;

function testAuthMiddleware(req: Request, _res: Response, next: NextFunction) {
  const user = req.app.locals.testUser;
  if (user) {
    req.user = user;
    req.auth = {
      type: AuthType.API_KEY,
      apiKey: { kind: ApiKeyKind.SERVICE, permissions: Object.values(ApiPermission) },
    };
  }
  next();
}

/** A media-level report by default; overrides pick a different target. */
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

/** What is left, keyed by the description each row was seeded with. */
async function remaining(): Promise<Record<string, ReportStatus>> {
  const rows = await Report.find();
  return Object.fromEntries(rows.map((r) => [r.description ?? String(r.id), r.status]));
}

beforeAll(async () => {
  core = await seedCoreFixtures();
  app = buildApplication({
    rateLimit: false,
    beforeRoutes: [testAuthMiddleware],
    mountRoutes: (instance) => {
      instance.use('/', AdminRoutes);
    },
  });
});

beforeEach(async () => {
  app.locals.testUser = core.users.kevin;
  // Reset per test so the seeded descriptions are stable names to assert on.
  counter = 0;
  await Report.query('DELETE FROM "Report"');

  const fixtures = await loadFixtures(['mediaWithEpisode']);
  mediaId = fixtures.media.testShow!.id;
  // A second title, so "this filter did not reach other media" is assertable.
  // Cloned rather than loaded from another fixture set: every set names its
  // media `testShow`, and the loader refuses two that collide on a key.
  const { id: _id, ...clone } = fixtures.media.testShow!;
  otherMediaId = (
    await Media.save(Media.create({ ...clone, slug: 'admin-bulk-other-show', publicId: 'AdminBulkOther' } as Media))
  ).id;
});

describe('PATCH /v1/admin/reports/batch', () => {
  it('moves the selected reports', async () => {
    const report = await seedReport();

    const res = await request(app)
      .patch('/v1/admin/reports/batch')
      .send({ ids: [report.id], status: ReportStatus.FIXED });

    expect(res.status).toBe(200);
    expect(res.body.count).toBe(1);
    expect((await remaining())['report-1']).toBe(ReportStatus.FIXED);
  });

  it('moves the siblings in each selected report’s group', async () => {
    // The admin is looking at a list of groups. Moving one row of a group
    // leaves the group on the screen with a different count.
    const report = await seedReport();
    await seedReport();

    const res = await request(app)
      .patch('/v1/admin/reports/batch')
      .send({ ids: [report.id], status: ReportStatus.FIXED });

    expect(res.body.count).toBe(2);
    expect(Object.values(await remaining())).toEqual([ReportStatus.FIXED, ReportStatus.FIXED]);
  });

  it('does not touch a different group', async () => {
    const report = await seedReport();
    await seedReport({ description: 'other-group', targetType: ReportTargetType.EPISODE, targetEpisodeNumber: 1 });

    await request(app)
      .patch('/v1/admin/reports/batch')
      .send({ ids: [report.id], status: ReportStatus.FIXED });

    expect((await remaining())['other-group']).toBe(ReportStatus.OPEN);
  });

  it('writes admin notes when they were given', async () => {
    const report = await seedReport();

    await request(app)
      .patch('/v1/admin/reports/batch')
      .send({ ids: [report.id], status: ReportStatus.DISMISSED, adminNotes: 'working as intended' });

    expect((await Report.findOneByOrFail({ id: report.id })).adminNotes).toBe('working as intended');
  });

  it('reports zero for ids that match nothing, rather than failing', async () => {
    // The admin's selection can go stale between the list and the action.
    const res = await request(app)
      .patch('/v1/admin/reports/batch')
      .send({ ids: [99_999_999], status: ReportStatus.FIXED });

    expect(res.status).toBe(200);
    expect(res.body.count).toBe(0);
  });
});

describe('PATCH /v1/admin/reports/bulk', () => {
  it('moves everything the filter selects', async () => {
    await seedReport();
    await seedReport();

    const res = await request(app)
      .patch('/v1/admin/reports/bulk')
      .send({ status: ReportStatus.FIXED, filters: { targetMediaId: mediaId } });

    expect(res.status).toBe(200);
    expect(res.body.count).toBe(2);
  });

  it('respects the media filter rather than moving every report there is', async () => {
    await seedReport();
    await seedReport({ description: 'elsewhere', targetMediaId: otherMediaId });

    await request(app)
      .patch('/v1/admin/reports/bulk')
      .send({ status: ReportStatus.FIXED, filters: { targetMediaId: mediaId } });

    expect((await remaining())['elsewhere']).toBe(ReportStatus.OPEN);
  });

  it('respects the status filter', async () => {
    await seedReport();
    await seedReport({ description: 'already-dismissed', status: ReportStatus.DISMISSED });

    const res = await request(app)
      .patch('/v1/admin/reports/bulk')
      .send({ status: ReportStatus.FIXED, filters: { status: ReportStatus.OPEN } });

    expect(res.body.count).toBe(1);
    expect((await remaining())['already-dismissed']).toBe(ReportStatus.DISMISSED);
  });

  it('respects the source filter', async () => {
    await seedReport();
    await seedReport({ description: 'automatic', source: ReportSource.AUTO });

    await request(app)
      .patch('/v1/admin/reports/bulk')
      .send({ status: ReportStatus.FIXED, filters: { source: ReportSource.AUTO } });

    const after = await remaining();
    expect(after.automatic).toBe(ReportStatus.FIXED);
    expect(after['report-1']).toBe(ReportStatus.OPEN);
  });

  it('refuses an empty filter set, which would move the whole table', async () => {
    await seedReport();

    const res = await request(app).patch('/v1/admin/reports/bulk').send({ status: ReportStatus.FIXED, filters: {} });

    expect(res.status).toBe(400);
    expect((await remaining())['report-1']).toBe(ReportStatus.OPEN);
  });

  it('refuses a missing filter set too', async () => {
    await seedReport();

    const res = await request(app).patch('/v1/admin/reports/bulk').send({ status: ReportStatus.FIXED });

    expect(res.status).toBe(400);
    expect((await remaining())['report-1']).toBe(ReportStatus.OPEN);
  });

  it('writes admin notes across the selection', async () => {
    await seedReport();

    await request(app)
      .patch('/v1/admin/reports/bulk')
      .send({ status: ReportStatus.DISMISSED, adminNotes: 'bulk triage', filters: { targetMediaId: mediaId } });

    expect((await Report.findOneByOrFail({ description: 'report-1' })).adminNotes).toBe('bulk triage');
  });
});

describe('DELETE /v1/admin/reports/:reportId', () => {
  it('deletes the report and its siblings', async () => {
    // Deleting one row of a group leaves the group half-present, which reads on
    // the admin screen as a report that would not go away.
    const report = await seedReport();
    await seedReport();

    const res = await request(app).delete(`/v1/admin/reports/${report.id}`);

    expect(res.status).toBe(200);
    expect(res.body.count).toBe(2);
    expect(await Report.count()).toBe(0);
  });

  it('leaves other groups alone', async () => {
    const report = await seedReport();
    await seedReport({ description: 'other-group', targetType: ReportTargetType.EPISODE, targetEpisodeNumber: 1 });

    await request(app).delete(`/v1/admin/reports/${report.id}`);

    expect(Object.keys(await remaining())).toEqual(['other-group']);
  });

  it('404s a report that is not there', async () => {
    const res = await request(app).delete('/v1/admin/reports/99999999');

    expect(res.status).toBe(404);
  });
});

describe('DELETE /v1/admin/reports/bulk', () => {
  it('deletes everything the filter selects', async () => {
    await seedReport();
    await seedReport();

    const res = await request(app)
      .delete('/v1/admin/reports/bulk')
      .send({ filters: { targetMediaId: mediaId } });

    expect(res.status).toBe(200);
    expect(res.body.count).toBe(2);
    expect(await Report.count()).toBe(0);
  });

  it('REFUSES an empty filter set -- the one that would empty the table', async () => {
    // There is no undo for this, which is why the guard is in the parser rather
    // than left to each caller to remember.
    await seedReport();

    const res = await request(app).delete('/v1/admin/reports/bulk').send({ filters: {} });

    expect(res.status).toBe(400);
    expect(await Report.count()).toBe(1);
  });

  it('refuses a missing filter set', async () => {
    await seedReport();

    const res = await request(app).delete('/v1/admin/reports/bulk').send({});

    expect(res.status).toBe(400);
    expect(await Report.count()).toBe(1);
  });

  it('does not reach past the filter into another title', async () => {
    await seedReport();
    await seedReport({ description: 'elsewhere', targetMediaId: otherMediaId });

    await request(app)
      .delete('/v1/admin/reports/bulk')
      .send({ filters: { targetMediaId: mediaId } });

    expect(Object.keys(await remaining())).toEqual(['elsewhere']);
  });

  it('deletes only the statuses asked for', async () => {
    await seedReport({ description: 'open-one' });
    await seedReport({ description: 'fixed-one', status: ReportStatus.FIXED });

    await request(app)
      .delete('/v1/admin/reports/bulk')
      .send({ filters: { status: ReportStatus.FIXED } });

    expect(Object.keys(await remaining())).toEqual(['open-one']);
  });
});
