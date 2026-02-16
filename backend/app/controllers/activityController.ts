import type { UserActivityIndex, UserActivityDestroy, UserActivityStatsShow } from 'generated/routes/user';
import { UserActivity } from '@app/models/UserActivity';
import { AuthCredentialsInvalidError } from '@app/errors';
import { getUserActivityStats, clearUserActivity } from '@app/services/activityService';
import { type FindOptionsWhere, LessThan } from 'typeorm';
import type { ActivityType } from '@app/models/UserActivity';

export const userActivityIndex: UserActivityIndex = async ({ query }, respond, req) => {
  const user = req.user;
  if (!user) {
    throw new AuthCredentialsInvalidError('Invalid session user.');
  }

  const { cursor, size, activityType } = query;

  const where: FindOptionsWhere<UserActivity> = { userId: user.id };
  if (activityType) {
    where.activityType = activityType as ActivityType;
  }
  if (cursor) {
    where.id = LessThan(cursor);
  }

  const activities = await UserActivity.find({
    where,
    order: { id: 'DESC' },
    take: size + 1,
  });

  const hasMore = activities.length > size;
  const data = hasMore ? activities.slice(0, size) : activities;
  const nextCursor = hasMore ? (data[data.length - 1]?.id ?? null) : null;

  return respond.with200().body({
    data: data.map((a) => ({
      id: a.id,
      activityType: a.activityType,
      segmentUuid: a.segmentUuid,
      mediaId: a.mediaId,
      searchQuery: a.searchQuery,
      createdAt: a.createdAt.toISOString(),
    })),
    hasMore,
    cursor: nextCursor,
  });
};

export const userActivityStatsShow: UserActivityStatsShow = async (_params, respond, req) => {
  const user = req.user;
  if (!user) {
    throw new AuthCredentialsInvalidError('Invalid session user.');
  }

  const stats = await getUserActivityStats(user.id);
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
