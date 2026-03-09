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
import { ActivityType, UserActivity } from '@app/models/UserActivity';
import { toUserActivityListDTO } from '@app/controllers/mappers/activity.mapper';
import { NotFoundError } from '@app/errors';
import { logger } from '@config/log';

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

  const activityByDay = await UserActivity.getHeatmapForUser(user.id, query.days);

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

  UserActivity.trackForUser(user, body.activityType as ActivityType, {
    segmentId: body.segmentId,
    mediaId: body.mediaId,
    searchQuery: body.searchQuery,
    mediaName: body.mediaName,
    japaneseText: body.japaneseText,
  }).catch((err: unknown) => {
    logger.warn({ err, userId: user.id, activityType: body.activityType }, 'Failed to track user activity');
  });

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
    throw new NotFoundError('Activity not found.');
  }

  return respond.with204().body(undefined);
};
