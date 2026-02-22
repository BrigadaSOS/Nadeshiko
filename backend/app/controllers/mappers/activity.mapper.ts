import type { t_UserActivity } from 'generated/models';
import type { UserActivity } from '@app/models/UserActivity';

export const toUserActivityDTO = (activity: UserActivity): t_UserActivity => ({
  id: activity.id,
  activityType: activity.activityType,
  segmentUuid: activity.segmentUuid,
  mediaId: activity.mediaId,
  searchQuery: activity.searchQuery,
  animeName: activity.animeName,
  japaneseText: activity.japaneseText,
  createdAt: activity.createdAt.toISOString(),
});

export const toUserActivityListDTO = (activities: UserActivity[]): t_UserActivity[] =>
  activities.map(toUserActivityDTO);
