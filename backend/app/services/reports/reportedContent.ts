import { Media, Report, ReportSource, ReportStatus, ReportTargetType } from '@app/models';
import { Cache, createCacheNamespace } from '@lib/cache';

/** Ranking uses only user OPEN/PROCESSING reports: hide bad segments, demote titles, exclude episode reports, and do
 * not count legacy AUTO rows. */
export interface UnhandledReports {
  /** Segment ids with an unhandled report. Excluded from results entirely. */
  segmentIds: ReadonlySet<number>;
  /**
   * Score multiplier per title, for the titles that earned one. Absent means 1 --
   * the map holds only penalties, so an empty map costs the query nothing.
   */
  mediaWeights: ReadonlyMap<number, number>;
}

/** A title with an unhandled report against the title itself. */
const TITLE_REPORT_WEIGHT = 0.35;

/** Use reported density rather than raw count so popularity does not punish a title; do not compound segment and
 * title penalties. */
const DENSITY_TIERS: readonly { minDensity: number; weight: number }[] = [
  { minDensity: 0.02, weight: 0.2 },
  { minDensity: 0.005, weight: 0.4 },
  { minDensity: 0.001, weight: 0.7 },
];

/** Require a minimum number of reported segments before applying density, so one report cannot demote a short title. */
const MIN_REPORTED_SEGMENTS_FOR_DENSITY = 3;

const REPORTED_CONTENT_CACHE = createCacheNamespace('reportedContent', 1);
const REPORTED_CONTENT_KEY = 'unhandledReports';

/** Keep the cache TTL short enough that a resolved report is reflected even if explicit invalidation is missed. */
const REPORTED_CONTENT_TTL_MS = 5 * 60 * 1000;

export async function getUnhandledReports(): Promise<UnhandledReports> {
  return Cache.getOrCompute(REPORTED_CONTENT_CACHE, REPORTED_CONTENT_KEY, REPORTED_CONTENT_TTL_MS, async () => {
    // One query for every shape: they are read together on every search, and
    // extra round trips would multiply the cost of the cold path for no benefit.
    const rows = await Report.createQueryBuilder('report')
      .select('report.target_type', 'targetType')
      .addSelect('report.target_media_id', 'mediaId')
      .addSelect('report.target_segment_id', 'segmentId')
      .distinct(true)
      .where('report.target_type IN (:...targetTypes)', {
        targetTypes: [ReportTargetType.MEDIA, ReportTargetType.SEGMENT],
      })
      .andWhere('report.source = :source', { source: ReportSource.USER })
      .andWhere('report.status IN (:...statuses)', { statuses: [ReportStatus.OPEN, ReportStatus.PROCESSING] })
      .getRawMany<{ targetType: string; mediaId: number | string; segmentId: number | string | null }>();

    const reportedTitles = new Set<number>();
    const segmentIds = new Set<number>();
    // Counted per title rather than derived from `segmentIds` later, which would
    // need a second lookup from segment id back to the title it belongs to.
    const reportedSegmentsByMedia = new Map<number, number>();

    for (const row of rows) {
      const mediaId = Number(row.mediaId);

      if (row.targetType !== ReportTargetType.SEGMENT) {
        reportedTitles.add(mediaId);
        continue;
      }

      // A SEGMENT report without a segment id would otherwise become NaN and
      // exclude nothing while looking like it excluded something.
      if (row.segmentId == null) continue;

      // DISTINCT is over the whole row, so two reasons filed against the same
      // segment arrive as two rows; the set is what makes the count per segment.
      if (segmentIds.has(Number(row.segmentId))) continue;
      segmentIds.add(Number(row.segmentId));
      reportedSegmentsByMedia.set(mediaId, (reportedSegmentsByMedia.get(mediaId) ?? 0) + 1);
    }

    return {
      segmentIds,
      mediaWeights: await buildMediaWeights(reportedTitles, reportedSegmentsByMedia),
    };
  });
}

/** Apply the harsher title weight once, not as a product of independent penalties; a reported title must not vanish
 * as weight-squared. */
async function buildMediaWeights(
  reportedTitles: ReadonlySet<number>,
  reportedSegmentsByMedia: ReadonlyMap<number, number>,
): Promise<ReadonlyMap<number, number>> {
  const weights = new Map<number, number>();
  for (const mediaId of reportedTitles) weights.set(mediaId, TITLE_REPORT_WEIGHT);

  if (reportedSegmentsByMedia.size === 0) return weights;

  // Cached, and already loaded on the search path this feeds -- the segment
  // totals a density needs are not worth a query of their own.
  const { results } = await Media.getMediaInfoMap();

  for (const [mediaId, reportedSegments] of reportedSegmentsByMedia) {
    const segmentCount = results.get(mediaId)?.segmentCount ?? 0;
    const densityWeight = densityWeightFor(reportedSegments, segmentCount);
    if (densityWeight === null) continue;

    const existing = weights.get(mediaId);
    weights.set(mediaId, existing === undefined ? densityWeight : Math.min(existing, densityWeight));
  }

  return weights;
}

/** The tier `reportedSegments` out of `segmentCount` falls in, or null for no demotion. */
function densityWeightFor(reportedSegments: number, segmentCount: number): number | null {
  if (reportedSegments < MIN_REPORTED_SEGMENTS_FOR_DENSITY) return null;
  // A title whose segments are not indexed yet has no density to speak of, and
  // dividing by it would rank every such title at Infinity.
  if (segmentCount <= 0) return null;

  const density = reportedSegments / segmentCount;
  return DENSITY_TIERS.find((tier) => density >= tier.minDensity)?.weight ?? null;
}

/** Called from every path that writes a report, so a fix takes effect on the next search. */
export function invalidateUnhandledReports(): void {
  Cache.invalidate(REPORTED_CONTENT_CACHE);
}
