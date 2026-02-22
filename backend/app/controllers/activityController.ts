import type {
  ListUserActivity,
  DeleteUserActivity,
  GetUserActivityStats,
  GetUserActivityHeatmap,
  TrackUserActivity,
  DeleteUserActivityByDate,
  DeleteUserActivityById,
} from 'generated/routes/user';
import { assertUser } from '@app/middleware/authentication';
import { UserActivity, ActivityType } from '@app/models/UserActivity';
import { toUserActivityListDTO } from '@app/controllers/mappers/activity.mapper';

export const listUserActivity: ListUserActivity = async ({ query }, respond, req) => {
  const user = assertUser(req);

  const { activities, pagination } = await UserActivity.listForUser({
    userId: user.id,
    activityType: query.activityType,
    date: query.date,
    take: query.take,
    cursor: query.cursor,
  });

  return respond.with200().body({
    activities: toUserActivityListDTO(activities),
    pagination,
  });
};

export const getUserActivityHeatmap: GetUserActivityHeatmap = async ({ query }, respond, req) => {
  const user = assertUser(req);

  const activityByDay = await UserActivity.getHeatmapForUser(user.id, query.days, query.activityType);

  return respond.with200().body({ activityByDay });
};

export const getUserActivityStats: GetUserActivityStats = async ({ query }, respond, req) => {
  const user = assertUser(req);

  const since = query.since ? new Date(query.since) : undefined;
  const stats = await UserActivity.getStatsForUser(user.id, since);

  return respond.with200().body(stats);
};

export const deleteUserActivity: DeleteUserActivity = async ({ query }, respond, req) => {
  const user = assertUser(req);

  const deletedCount = await UserActivity.clearForUser(user.id, query.activityType);

  return respond.with200().body({
    deletedCount,
  });
};

export const trackUserActivity: TrackUserActivity = async ({ body }, respond, req) => {
  const user = assertUser(req);

  UserActivity.trackForUser(user, ActivityType.SEGMENT_PLAY, {
    segmentUuid: body.segmentUuid,
    mediaId: body.mediaId,
    animeName: body.animeName,
    japaneseText: body.japaneseText,
  }).catch(() => {});

  return respond.with204().body(undefined);
};

export const deleteUserActivityByDate: DeleteUserActivityByDate = async ({ params }, respond, req) => {
  const user = assertUser(req);

  const result = await UserActivity.createQueryBuilder()
    .delete()
    .where('user_id = :userId', { userId: user.id })
    .andWhere('DATE(created_at) = :date', { date: params.date })
    .execute();

  return respond.with200().body({ deletedCount: result.affected || 0 });
};

export const deleteUserActivityById: DeleteUserActivityById = async ({ params }, respond, req) => {
  const user = assertUser(req);

  const result = await UserActivity.delete({ id: params.id, userId: user.id });
  if (!result.affected) {
    return respond.with404().body({ message: 'Activity not found.' });
  }

  return respond.with204().body(undefined);
};
