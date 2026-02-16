import type {
  UserActivityIndex,
  UserActivityDestroy,
  UserActivityStatsShow,
  UserActivityHeatmapShow,
} from 'generated/routes/user';
import { UserActivity } from '@app/models/UserActivity';
import { AuthCredentialsInvalidError } from '@app/errors';
import { getUserActivityStats, getActivityHeatmap, clearUserActivity } from '@app/services/activityService';

export const userActivityIndex: UserActivityIndex = async ({ query }, respond, req) => {
  const user = req.user;
  if (!user) {
    throw new AuthCredentialsInvalidError('Invalid session user.');
  }

  const { cursor, limit, activityType, date } = query;

  const qb = UserActivity.createQueryBuilder('a')
    .where('a.user_id = :userId', { userId: user.id })
    .orderBy('a.id', 'DESC')
    .take(limit + 1);

  if (activityType) {
    qb.andWhere('a.activity_type = :activityType', { activityType });
  }
  if (cursor) {
    qb.andWhere('a.id < :cursor', { cursor });
  }
  if (date) {
    qb.andWhere('DATE(a.created_at) = :date', { date });
  }

  const activities = await qb.getMany();

  const hasMore = activities.length > limit;
  const data = hasMore ? activities.slice(0, limit) : activities;
  const nextCursor = hasMore ? (data[data.length - 1]?.id ?? null) : null;

  return respond.with200().body({
    activities: data.map((a) => ({
      id: a.id,
      activityType: a.activityType,
      segmentUuid: a.segmentUuid,
      mediaId: a.mediaId,
      searchQuery: a.searchQuery,
      createdAt: a.createdAt.toISOString(),
    })),
    pagination: {
      hasMore,
      cursor: nextCursor,
    },
  });
};

export const userActivityHeatmapShow: UserActivityHeatmapShow = async ({ query }, respond, req) => {
  const user = req.user;
  if (!user) {
    throw new AuthCredentialsInvalidError('Invalid session user.');
  }

  const days = query.days ?? 365;
  const counts = await getActivityHeatmap(user.id, days, query.activityType);
  return respond.with200().body({ counts });
};

export const userActivityStatsShow: UserActivityStatsShow = async ({ query }, respond, req) => {
  const user = req.user;
  if (!user) {
    throw new AuthCredentialsInvalidError('Invalid session user.');
  }

  const since = query.since ? new Date(query.since) : undefined;
  const stats = await getUserActivityStats(user.id, since);
  return respond.with200().body(stats);
};

export const userActivityDestroy: UserActivityDestroy = async ({ query }, respond, req) => {
  const user = req.user;
  if (!user) {
    throw new AuthCredentialsInvalidError('Invalid session user.');
  }

  const deletedCount = await clearUserActivity(user.id, query.activityType);

  return respond.with200().body({
    message: 'Activity history cleared.',
    deletedCount,
  });
};
