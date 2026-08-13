import type { t_UserActivity, t_UserActivityStats } from 'generated/models';
import type { Media, UserActivity } from '@app/models';
import { blankToNull } from '@lib/utils/blank';

/**
 * `blankToNull` rather than `?? null` on every optional field: rows written before
 * the write path normalized them still hold `''`, and the response schema requires
 * `minLength: 1`. An empty column is a row that reads slightly worse; an empty
 * column that reaches the validator is a 500 for the entire page, and for the data
 * export that shares this mapper. Reading defensively keeps one stale row from
 * taking down a whole timeline even after the backfill has run.
 */
export const toUserActivityDTO = (activity: UserActivity): t_UserActivity => ({
  id: activity.id,
  activityType: activity.activityType,
  segmentPublicId: blankToNull(activity.segmentId),
  mediaPublicId: blankToNull(activity.mediaPublicId),
  searchQuery: blankToNull(activity.searchQuery),
  mediaName: blankToNull(activity.mediaName),
  japaneseText: blankToNull(activity.japaneseText),
  createdAt: activity.createdAt.toISOString(),
});

export const toUserActivityListDTO = (activities: UserActivity[]): t_UserActivity[] =>
  activities.map(toUserActivityDTO);

export const toTopMediaDTO = (
  topMedia: Array<{ mediaPublicId: string; count: number }>,
  mediaByPublicId: Map<string, Media>,
): t_UserActivityStats['topMedia'] =>
  topMedia
    .map((item) => {
      const media = mediaByPublicId.get(item.mediaPublicId);
      if (!media) return null;
      return {
        count: item.count,
        mediaPublicId: item.mediaPublicId,
        mediaName: media.nameEn || media.nameRomaji || media.nameJa,
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null);
