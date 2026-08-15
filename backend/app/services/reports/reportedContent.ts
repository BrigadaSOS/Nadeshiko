import { Media, Report, ReportSource, ReportStatus, ReportTargetType } from '@app/models';
import { Cache, createCacheNamespace } from '@lib/cache';

/**
 * What readers have reported and nobody has dealt with yet, in the two shapes
 * search cares about.
 *
 * Reported *segments* are hidden outright: the complaint is almost always that
 * the line itself is wrong -- bad translation, bad timing, bad audio -- so there
 * is nothing to rank, and one bad line among millions is not worth showing while
 * it waits. Titles are demoted instead of hidden, because no title-level
 * complaint (wrong cover, wrong metadata) says its subtitles are unusable, and
 * removing the catalogue entry would take tens of thousands of good segments
 * with it.
 *
 * Both are ranking inputs, which is why the set is narrower than "every report":
 *
 *   - `source = USER` only. The AUTO rows still in the table were written by a
 *     media-audit runner that no longer exists (see the legacy-reason note in
 *     app/models/Report.ts) -- nothing will ever move them out of OPEN, so
 *     counting them would be a permanent, invisible penalty on whichever titles
 *     that runner happened to flag before it was removed.
 *   - OPEN and PROCESSING both count. PROCESSING means someone has looked, not
 *     that the problem is gone; FIXED and DISMISSED restore the content.
 *   - EPISODE reports do nothing here. Hiding an episode's segments would remove
 *     thousands of lines on one reader's say-so, and demoting the whole title for
 *     one bad episode is the wrong shape too.
 *
 * Every report is trusted on its face -- no reporter-count threshold, no admin
 * acknowledgement. That is a deliberate call for the current volume, and the
 * first thing to revisit if reporting is ever used to bury content: one account
 * can hide any segment and demote any title here, and neither is visible from
 * the outside.
 */
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

/**
 * Demotion by how much of a title has been reported, harshest tier first.
 *
 * Density rather than a report count, because a count measures viewership: a
 * popular show collects more reports than a quiet one at the same error rate, and
 * ranking on the raw number would demote exactly the titles most people watch.
 *
 * The signal is about the lines NOT reported. Reported segments are already
 * hidden, so demoting a title for them would be punishing it twice -- what earns
 * the demotion is the inference that a track producing many bad lines is
 * producing bad lines nobody has got round to reporting yet.
 *
 * At current reporting volume these tiers fire rarely; `TITLE_REPORT_WEIGHT`
 * does most of the work. They are the knob to turn, in either direction, once
 * there is enough traffic to say what a normal error rate looks like.
 */
const DENSITY_TIERS: readonly { minDensity: number; weight: number }[] = [
  { minDensity: 0.02, weight: 0.2 },
  { minDensity: 0.005, weight: 0.4 },
  { minDensity: 0.001, weight: 0.7 },
];

/**
 * No density demotion below this many reported segments, whatever the ratio says.
 * A 40-line clip with one bad line is 2.5% "bad" on the arithmetic and fine in
 * reality; short titles would otherwise be demoted by a single report.
 */
const MIN_REPORTED_SEGMENTS_FOR_DENSITY = 3;

const REPORTED_CONTENT_CACHE = createCacheNamespace('reportedContent', 1);
const REPORTED_CONTENT_KEY = 'unhandledReports';

/**
 * Short enough that resolving a report restores the content within a few minutes
 * even when the invalidation below is bypassed -- a status changed directly in the
 * database, or another process holding its own copy of this cache.
 */
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

/**
 * The single weight each title ends up with.
 *
 * Deliberately not a product of the two penalties: a title reported at both
 * levels would compound to near-zero and vanish, which is a heavier decision than
 * either report supports. The harsher of the two applies and the other is
 * ignored, so the worst case stays the worst tier rather than the worst tier
 * squared.
 */
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
