import type {
  ListUserActivity,
  DeleteUserActivity,
  GetUserActivityStats,
  GetUserActivityHeatmap,
} from 'generated/routes/user';
import { assertUser } from '@app/middleware/authentication';
import { UserActivity } from '@app/models/UserActivity';
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
