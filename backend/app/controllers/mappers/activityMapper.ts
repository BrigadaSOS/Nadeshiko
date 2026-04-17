import type { t_UserActivity, t_UserActivityStats } from 'generated/models';
import type { Media, UserActivity } from '@app/models';

export const toUserActivityDTO = (activity: UserActivity): t_UserActivity => ({
  id: activity.id,
  activityType: activity.activityType,
  segmentPublicId: activity.segmentId ?? null,
  mediaPublicId: activity.mediaPublicId ?? null,
  searchQuery: activity.searchQuery ?? null,
  mediaName: activity.mediaName ?? null,
  japaneseText: activity.japaneseText ?? null,
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
