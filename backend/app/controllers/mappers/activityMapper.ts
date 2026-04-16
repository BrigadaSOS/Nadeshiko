import type { t_UserActivity } from 'generated/models';
import type { UserActivity } from '@app/models/UserActivity';

export const toUserActivityDTO = (activity: UserActivity, mediaPublicIdById: Map<number, string>): t_UserActivity => ({
  id: activity.id,
  activityType: activity.activityType,
  segmentPublicId: activity.segmentId ?? null,
  mediaPublicId: activity.mediaId ? (mediaPublicIdById.get(activity.mediaId) ?? null) : null,
  searchQuery: activity.searchQuery ?? null,
  mediaName: activity.mediaName ?? null,
  japaneseText: activity.japaneseText ?? null,
  createdAt: activity.createdAt.toISOString(),
});

export const toUserActivityListDTO = (
  activities: UserActivity[],
  mediaPublicIdById: Map<number, string>,
): t_UserActivity[] => activities.map((activity) => toUserActivityDTO(activity, mediaPublicIdById));
