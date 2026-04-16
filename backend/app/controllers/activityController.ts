import type { ListUserActivity, GetUserActivityStats, GetUserActivityHeatmap } from 'generated/routes/activity';
import type {
  DeleteUserActivity,
  TrackUserActivity,
  DeleteUserActivityByDate,
  DeleteUserActivityById,
} from 'generated/routes/user';
import { assertUser } from '@app/middleware/authentication';
import { Media } from '@app/models';
import { ActivityType, UserActivity } from '@app/models/UserActivity';
import { toUserActivityListDTO } from '@app/controllers/mappers/activityMapper';
import { NotFoundError } from '@app/errors';
import { logger } from '@config/log';

export const listUserActivity: ListUserActivity = async ({ query }, respond, req) => {
  const user = assertUser(req);

  const { items: activities, pagination } = await UserActivity.paginateWithKeyset({
    take: query.take,
    cursor: query.cursor,
    query: () => {
      const qb = UserActivity.createQueryBuilder('activity').where('activity.user_id = :userId', {
        userId: user.id,
      });
      if (query.activityType) {
        qb.andWhere('activity.activity_type = :activityType', { activityType: query.activityType });
      }
      if (query.date) {
        qb.andWhere('DATE(activity.created_at) = :date', { date: query.date });
      }
      return qb;
    },
  });

  const mediaPublicIdById = await loadMediaPublicIdMap(activities.map((activity) => activity.mediaId));

  return respond.with200().body({
    activities: toUserActivityListDTO(activities, mediaPublicIdById),
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
  const mediaRows = await Media.find({
    where: stats.topMedia.map((item) => ({ id: item.mediaId })),
    select: ['id', 'publicId', 'nameEn', 'nameRomaji', 'nameJa'],
  });
  const mediaById = new Map(mediaRows.map((media) => [media.id, media]));

  return respond.with200().body({
    ...stats,
    topMedia: stats.topMedia
      .map((item) => {
        const media = mediaById.get(item.mediaId);
        if (!media) {
          return null;
        }

        return {
          count: item.count,
          mediaPublicId: media.publicId,
          mediaName: media.nameEn || media.nameRomaji || media.nameJa,
        };
      })
      .filter((item): item is NonNullable<typeof item> => item !== null),
  });
};

export const deleteUserActivity: DeleteUserActivity = async ({ query }, respond, req) => {
  const user = assertUser(req);

  const count = await UserActivity.clearForUser(user.id, query.activityType);

  return respond.with200().body({ count });
};

export const trackUserActivity: TrackUserActivity = async ({ body }, respond, req) => {
  const user = assertUser(req);

  const mediaId = body.mediaPublicId ? await resolveMediaId(body.mediaPublicId) : undefined;

  UserActivity.trackForUser(user, body.activityType as ActivityType, {
    segmentId: body.segmentPublicId,
    mediaId,
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

  return respond.with200().body({ count: result.affected || 0 });
};

export const deleteUserActivityById: DeleteUserActivityById = async ({ params }, respond, req) => {
  const user = assertUser(req);

  const result = await UserActivity.delete({ id: params.activityId, userId: user.id });
  if (!result.affected) {
    throw new NotFoundError('Activity not found.');
  }

  return respond.with204().body(undefined);
};

async function loadMediaPublicIdMap(mediaIds: Array<number | null | undefined>): Promise<Map<number, string>> {
  const ids = [
    ...new Set(mediaIds.filter((id): id is number => typeof id === 'number' && Number.isInteger(id) && id > 0)),
  ];
  if (ids.length === 0) {
    return new Map();
  }

  const media = await Media.find({
    where: ids.map((id) => ({ id })),
    select: ['id', 'publicId'],
  });

  return new Map(media.map((item) => [item.id, item.publicId]));
}

async function resolveMediaId(mediaPublicId: string): Promise<number | undefined> {
  const media = await Media.findOne({
    where: { publicId: mediaPublicId },
    select: ['id'],
  });
  return media?.id;
}
