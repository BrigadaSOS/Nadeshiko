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
import { UserMediaAffinity } from '@app/models/UserMediaAffinity';
import { toUserActivityListDTO, toTopMediaDTO } from '@app/controllers/mappers/activityMapper';
import { NotFoundError } from '@app/errors';
import { logger } from '@config/log';

export const listUserActivity: ListUserActivity = async ({ query }, respond, req) => {
  const user = assertUser(req);

  const { items: activities, pagination } = await UserActivity.paginateWithKeyset({
    take: query.take,
    cursor: query.cursor,
    query: () => UserActivity.buildUserQuery(user.id, { activityType: query.activityType, date: query.date }),
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
  const mediaRows = await Media.find({
    where: stats.topMedia.map((item) => ({ publicId: item.mediaPublicId })),
    select: {
      publicId: true,
      nameEn: true,
      nameRomaji: true,
      nameJa: true,
    },
  });
  const mediaByPublicId = new Map(mediaRows.map((media) => [media.publicId, media]));

  return respond.with200().body({
    ...stats,
    topMedia: toTopMediaDTO(stats.topMedia, mediaByPublicId),
  });
};

export const deleteUserActivity: DeleteUserActivity = async ({ query }, respond, req) => {
  const user = assertUser(req);

  const count = await UserActivity.clearForUser(user.id, query.activityType);

  return respond.with200().body({ count });
};

export const trackUserActivity: TrackUserActivity = async ({ body }, respond, req) => {
  const user = assertUser(req);

  UserActivity.trackForUser(user, body.activityType as ActivityType, {
    segmentId: body.segmentPublicId,
    mediaPublicId: body.mediaPublicId,
    searchQuery: body.searchQuery,
    mediaName: body.mediaName,
    japaneseText: body.japaneseText,
  }).catch((err: unknown) => {
    logger.warn({ err, userId: user.id, activityType: body.activityType }, 'Failed to track user activity');
  });

  // The same event, counted for a different purpose, under a different consent.
  // Beside `trackForUser` rather than inside it: that one stops at
  // `searchHistory`, and the tally deliberately does not, so a reader who wants
  // their shows remembered without a diary of their searches gets exactly that.
  //
  // SEARCH is excluded by name, not by trusting that search events carry no
  // media id -- scoped searches have carried one before and may again.
  const isAutoplayedSegment = body.activityType === 'SEGMENT_PLAY' && body.autoplay === true;
  const shouldRecordAffinity =
    user.preferences?.familiarMedia?.enabled !== false &&
    body.activityType !== 'SEARCH' &&
    !isAutoplayedSegment &&
    !!body.mediaPublicId;

  if (shouldRecordAffinity && body.mediaPublicId) {
    UserMediaAffinity.incrementForUser(user.id, body.mediaPublicId, body.activityType as ActivityType).catch(
      (err: unknown) => {
        logger.warn({ err, userId: user.id, activityType: body.activityType }, 'Failed to record media affinity');
      },
    );
  }

  return respond.with204().body(undefined);
};

export const deleteUserActivityByDate: DeleteUserActivityByDate = async ({ params }, respond, req) => {
  const user = assertUser(req);

  const count = await UserActivity.deleteForUserByDate(user.id, params.date);

  return respond.with200().body({ count });
};

export const deleteUserActivityById: DeleteUserActivityById = async ({ params }, respond, req) => {
  const user = assertUser(req);

  const result = await UserActivity.delete({ id: params.activityId, userId: user.id });
  if (!result.affected) {
    throw new NotFoundError('Activity not found.');
  }

  return respond.with204().body(undefined);
};
