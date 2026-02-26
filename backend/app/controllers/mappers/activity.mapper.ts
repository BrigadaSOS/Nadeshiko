import type { t_UserActivity } from 'generated/models';
import type { UserActivity } from '@app/models/UserActivity';

export const toUserActivityDTO = (activity: UserActivity): t_UserActivity => ({
  id: activity.id,
  activityType: activity.activityType,
  segmentUuid: activity.segmentUuid ?? null,
  mediaId: activity.mediaId ?? null,
  searchQuery: activity.searchQuery ?? null,
  mediaName: activity.mediaName ?? null,
  japaneseText: activity.japaneseText ?? null,
  createdAt: activity.createdAt.toISOString(),
});

export const toUserActivityListDTO = (activities: UserActivity[]): t_UserActivity[] =>
  activities.map(toUserActivityDTO);
