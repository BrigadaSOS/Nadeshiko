import { describe, it, expect, beforeEach } from 'vitest';
import { setupTestSuite } from '../../helpers/setup';
import { loadFixtures } from '../../fixtures/loader';
import { Report, ReportReason, ReportSource, ReportStatus, ReportTargetType } from '@app/models';
// Not re-exported from the models barrel, so it has to come from the module itself.
import { MEDIA_INFO_CACHE } from '@app/models/Media';
import { Cache } from '@lib/cache';
import { getUnhandledReports, invalidateUnhandledReports } from '@app/services/reports/reportedContent';

setupTestSuite();

/**
 * Which reports hide a segment, and what a title's demotion ends up being.
 *
 * Both failure directions are invisible from the outside: content that should not
 * be in these sets is silently removed or buried, and content missing from them
 * goes on ranking normally. So the boundaries are pinned one at a time rather
 * than through a single happy-path case.
 */
const report = (overrides: Partial<Report>) =>
  Report.save(
    Report.create({
      source: ReportSource.USER,
      targetType: ReportTargetType.MEDIA,
      reason: ReportReason.WRONG_METADATA,
      status: ReportStatus.OPEN,
      ...overrides,
    }),
  );

const segmentReport = (overrides: Partial<Report>) =>
  report({ targetType: ReportTargetType.SEGMENT, reason: ReportReason.WRONG_TRANSLATION, ...overrides });

/** A title of a known length, which is the denominator every density case needs. */
async function seedTitle(segmentCount: number): Promise<number> {
  const { media } = await loadFixtures(['singleMedia']);
  const title = media.testShow!;
  title.segmentCount = segmentCount;
  await title.save();
  return title.id;
}

/** `count` reported segments against `mediaId`, each a distinct segment. */
async function reportSegments(mediaId: number, count: number): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    await segmentReport({ targetMediaId: mediaId, targetSegmentId: 100_000 + index });
  }
}

const weightFor = async (mediaId: number) => (await getUnhandledReports()).mediaWeights.get(mediaId);

beforeEach(() => {
  // Both are process-caches, so values computed by the previous test would
  // outlive the transaction that rolled its rows back.
  invalidateUnhandledReports();
  Cache.invalidate(MEDIA_INFO_CACHE);
});

describe('getUnhandledReports: what is hidden', () => {
  it('hides reported segments and nothing else', async () => {
    const mediaId = await seedTitle(1000);
    await reportSegments(mediaId, 2);

    const reports = await getUnhandledReports();

    expect([...reports.segmentIds].sort()).toEqual([100_000, 100_001]);
    // Two bad lines out of a thousand is not a bad show. The title keeps full
    // ranking; only the two lines go.
    expect(reports.mediaWeights.get(mediaId)).toBeUndefined();
  });

  it('releases content once its report is fixed or dismissed', async () => {
    await report({ targetMediaId: 301, status: ReportStatus.FIXED });
    await segmentReport({ targetMediaId: 302, targetSegmentId: 9003, status: ReportStatus.DISMISSED });

    const reports = await getUnhandledReports();

    expect(reports.segmentIds).toEqual(new Set());
    expect(reports.mediaWeights).toEqual(new Map());
  });

  it('counts both OPEN and PROCESSING', async () => {
    // PROCESSING means someone has looked at it, not that the problem is gone.
    await report({ targetMediaId: 201, status: ReportStatus.PROCESSING });
    await segmentReport({ targetMediaId: 201, targetSegmentId: 9002, status: ReportStatus.PROCESSING });

    const reports = await getUnhandledReports();

    expect(reports.segmentIds).toEqual(new Set([9002]));
    expect(reports.mediaWeights.get(201)).toBeDefined();
  });

  it('ignores episode reports entirely', async () => {
    // Neither shape fits: hiding an episode drops thousands of lines on one
    // reader's say-so, and demoting the title punishes the other episodes.
    await report({ targetMediaId: 401, targetType: ReportTargetType.EPISODE, targetEpisodeNumber: 3 });

    const reports = await getUnhandledReports();

    expect(reports.segmentIds).toEqual(new Set());
    expect(reports.mediaWeights).toEqual(new Map());
  });

  it('ignores AUTO rows', async () => {
    // Left behind by a media-audit runner that no longer exists. Nothing will
    // ever move them out of OPEN, so counting them would be a permanent penalty.
    await report({ targetMediaId: 501, source: ReportSource.AUTO, reason: ReportReason.LOW_SEGMENT_MEDIA });

    expect((await getUnhandledReports()).mediaWeights).toEqual(new Map());
  });
});

describe('getUnhandledReports: what a title weighs', () => {
  it('demotes a title reported about itself', async () => {
    await report({ targetMediaId: 601, reason: ReportReason.WRONG_TITLE });

    expect(await weightFor(601)).toBe(0.35);
  });

  it('demotes a title reported about itself once, however many reports', async () => {
    // A wrong cover is not twice as wrong for being reported twice.
    await report({ targetMediaId: 602, reason: ReportReason.WRONG_TITLE });
    await report({ targetMediaId: 602, reason: ReportReason.WRONG_COVER_IMAGE });

    expect(await weightFor(602)).toBe(0.35);
  });

  it('deepens the demotion as more of the title is reported', async () => {
    // The tiers, walked one at a time against the same 1000-line denominator:
    // 0.3% earns the mildest, 1% the middle, 3% the harshest.
    const light = await seedTitle(1000);
    await reportSegments(light, 3);
    expect(await weightFor(light)).toBe(0.7);

    invalidateUnhandledReports();
    await reportSegments(light, 10);
    expect(await weightFor(light)).toBe(0.4);

    invalidateUnhandledReports();
    await reportSegments(light, 30);
    expect(await weightFor(light)).toBe(0.2);
  });

  it('does not demote a short title for a couple of reports', async () => {
    // Two lines out of forty is 5% on the arithmetic, which would otherwise be
    // the harshest tier. The absolute floor is what stops a clip being buried by
    // a single reader.
    const shortTitle = await seedTitle(40);
    await reportSegments(shortTitle, 2);

    expect(await weightFor(shortTitle)).toBeUndefined();
  });

  it('does not demote a title whose segments are not indexed yet', async () => {
    // segmentCount 0 is a title mid-import, not a title that is all errors.
    const unindexed = await seedTitle(0);
    await reportSegments(unindexed, 5);

    expect(await weightFor(unindexed)).toBeUndefined();
  });

  it('takes the harsher of the two penalties rather than compounding them', async () => {
    const mediaId = await seedTitle(1000);
    await report({ targetMediaId: mediaId, reason: ReportReason.WRONG_TITLE });
    await reportSegments(mediaId, 30);

    // 0.35 and 0.2 both apply; multiplied they would be 0.07, which buries the
    // title on evidence neither report gives on its own.
    expect(await weightFor(mediaId)).toBe(0.2);
  });

  it('keeps the title penalty when the density penalty is milder', async () => {
    const mediaId = await seedTitle(1000);
    await report({ targetMediaId: mediaId, reason: ReportReason.WRONG_TITLE });
    await reportSegments(mediaId, 3);

    expect(await weightFor(mediaId)).toBe(0.35);
  });

  it('serves the cached sets until they are invalidated', async () => {
    await report({ targetMediaId: 701 });
    expect(await weightFor(701)).toBe(0.35);

    await report({ targetMediaId: 702 });
    expect(await weightFor(702)).toBeUndefined();

    invalidateUnhandledReports();
    expect(await weightFor(702)).toBe(0.35);
  });
});
