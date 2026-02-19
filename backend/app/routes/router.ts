import express from 'express';
import { requireApiKeyAuth, requireSessionAuth } from '@app/middleware/authentication';
import { AuthType } from '@app/models/ApiPermission';
import { requirePermissions } from '@app/middleware/authorization';
import { ApiPermission } from '@app/models/ApiPermission';
import { rateLimitApiQuota } from '@app/middleware/apiLimiterQuota';
import { InsufficientPermissionsError } from '@app/errors';
import { search, getSearchStats, searchWords } from '@app/controllers/searchController';
import { trackActivity } from '@app/services/activityService';
import { ActivityType, UserActivity } from '@app/models/UserActivity';
import { getAdminHealth } from '@app/controllers/adminHealthController';
import { getAdminDashboard } from '@app/controllers/adminDashboardController';
import {
  triggerReindex,
  listAdminQueueStats,
  getAdminQueue,
  retryAdminQueueFailed,
  listAdminQueueFailed,
  purgeAdminQueueFailed,
} from '@app/controllers/adminController';
import { impersonateUserForDevelopment, clearDevelopmentImpersonation } from '@app/controllers/devAuthController';
import { isLocalEnvironment } from '@config/environment';
import {
  listMedia,
  createMedia,
  getMedia,
  updateMedia,
  deleteMedia,
  autocompleteMedia,
} from '@app/controllers/mediaController';
import { getCharacter } from '@app/controllers/characterController';
import { getSeiyuu } from '@app/controllers/seiyuuController';
import {
  listCollections,
  getCollection,
  createCollection,
  updateCollection,
  deleteCollection,
  addSegmentToCollection,
  updateCollectionSegment,
  removeSegmentFromCollection,
} from '@app/controllers/collectionController';
import {
  listSeries,
  getSeries,
  createSeries,
  updateSeries,
  deleteSeries,
  addMediaToSeries,
  updateSeriesMedia,
  removeMediaFromSeries,
} from '@app/controllers/seriesController';
import {
  listEpisodes,
  createEpisode,
  getEpisode,
  updateEpisode,
  deleteEpisode,
} from '@app/controllers/episodeController';
import {
  listSegments,
  createSegment,
  getSegment,
  updateSegment,
  deleteSegment,
  getSegmentByUuid,
  getSegmentContext,
} from '@app/controllers/segmentController';
import { getUserQuota } from '@app/controllers/userQuotaController';
import {
  createUserReport,
  listUserReports,
  listAdminReports,
  updateAdminReport,
} from '@app/controllers/reportController';
import { getUserPreferences, updateUserPreferences } from '@app/controllers/preferencesController';
import { listUserLabs } from '@app/controllers/labsController';
import {
  listUserActivity,
  getUserActivityHeatmap,
  getUserActivityStats,
  deleteUserActivity,
} from '@app/controllers/activityController';
import { exportUserData } from '@app/controllers/userExportController';
import {
  runAdminReview,
  listAdminReviewChecks,
  updateAdminReviewCheck,
  listAdminReviewRuns,
  getAdminReviewRun,
  listAdminReviewAllowlist,
  createAdminReviewAllowlistEntry,
  deleteAdminReviewAllowlistEntry,
} from '@app/controllers/mediaReviewController';
import { createRouter as createSearchRouter } from 'generated/routes/search';
import { createRouter as createMediaRouter } from 'generated/routes/media';
import { createRouter as createCollectionsRouter } from 'generated/routes/collections';
import { createRouter as createAdminRouter } from 'generated/routes/admin';
import { createRouter as createUserRouter } from 'generated/routes/user';

const router = express.Router();

const SearchRoutes = createSearchRouter({
  search,
  getSearchStats,
  searchWords,
});

const MediaRoutes = createMediaRouter({
  listMedia,
  createMedia,
  autocompleteMedia,
  getMedia,
  updateMedia,
  deleteMedia,
  listEpisodes,
  createEpisode,
  getEpisode,
  updateEpisode,
  deleteEpisode,
  listSegments,
  createSegment,
  getSegment,
  updateSegment,
  deleteSegment,
  getSegmentByUuid,
  getSegmentContext,
  listSeries,
  createSeries,
  getSeries,
  updateSeries,
  deleteSeries,
  addMediaToSeries,
  updateSeriesMedia,
  removeMediaFromSeries,
  getCharacter,
  getSeiyuu,
});

const CollectionsRoutes = createCollectionsRouter({
  listCollections,
  createCollection,
  getCollection,
  updateCollection,
  deleteCollection,
  addSegmentToCollection,
  updateCollectionSegment,
  removeSegmentFromCollection,
});

const AdminRoutes = createAdminRouter({
  getAdminDashboard,
  getAdminHealth,
  triggerReindex,
  listAdminQueueStats,
  getAdminQueue,
  listAdminQueueFailed,
  retryAdminQueueFailed,
  purgeAdminQueueFailed,
  listAdminReports,
  updateAdminReport,
  runAdminReview,
  listAdminReviewChecks,
  updateAdminReviewCheck,
  listAdminReviewRuns,
  getAdminReviewRun,
  listAdminReviewAllowlist,
  createAdminReviewAllowlistEntry,
  deleteAdminReviewAllowlistEntry,
});

const UserRoutes = createUserRouter({
  getUserQuota,
  createUserReport,
  listUserReports,
  getUserPreferences,
  updateUserPreferences,
  listUserActivity,
  deleteUserActivity,
  getUserActivityHeatmap,
  getUserActivityStats,
  exportUserData,
  listUserLabs,
});

const apiKeyOnly = [requireApiKeyAuth, rateLimitApiQuota] as const;

const searchAccess = [requireApiKeyAuth, requirePermissions(ApiPermission.READ_MEDIA), rateLimitApiQuota] as const;

const mediaReadPermission = [requirePermissions(ApiPermission.READ_MEDIA)] as const;
const mediaAddPermission = [requirePermissions(ApiPermission.ADD_MEDIA)] as const;
const mediaUpdatePermission = [requirePermissions(ApiPermission.UPDATE_MEDIA)] as const;
const mediaRemovePermission = [requirePermissions(ApiPermission.REMOVE_MEDIA)] as const;

const requireApiKeyOrSession = async (req: any, res: any, next: any) => {
  const hasBearer = req.headers.authorization?.startsWith('Bearer ');
  if (hasBearer) {
    return requireApiKeyAuth(req, res, next);
  }
  return requireSessionAuth(req, res, next);
};

if (isLocalEnvironment()) {
  router.post('/v1/dev/auth/impersonate', impersonateUserForDevelopment);
  router.post('/v1/dev/auth/impersonate/clear', clearDevelopmentImpersonation);
}
// /v1/user/quota supports both API key and session auth
router.use('/v1/user/quota', requireApiKeyOrSession);
router.use('/v1/user/quota', (req: any, _res: any, next: any) => {
  if (req.auth?.type !== AuthType.SESSION) {
    return requirePermissions(ApiPermission.READ_MEDIA)(req, _res, () => {
      return rateLimitApiQuota(req, _res, next);
    });
  }
  next();
});
// All other /v1/user endpoints require session auth only
router.use('/v1/user', requireSessionAuth);

router.use('/v1/search', ...searchAccess);
router.use('/v1/admin', async (req: any, res: any, next: any) => {
  const hasBearer = req.headers.authorization?.startsWith('Bearer ');
  if (hasBearer) {
    return requireApiKeyAuth(req, res, next);
  }
  return requireSessionAuth(req, res, next);
});
router.use('/v1/admin', (req: any, _res: any, next: any) => {
  if (req.auth?.type === AuthType.SESSION) {
    // Session users must be admins
    if (req.user?.role !== 'ADMIN') {
      throw new InsufficientPermissionsError('Admin access required.');
    }
    return next();
  }
  // API key users go through normal permission checks + rate limiting
  return requirePermissions(ApiPermission.ADD_MEDIA)(req, _res, () => {
    return rateLimitApiQuota(req, _res, next);
  });
});
router.use('/v1/media', ...apiKeyOnly);
router.use('/v1/collections', requireSessionAuth);

router.get('/v1/media', ...mediaReadPermission);
router.get('/v1/media/*path', ...mediaReadPermission);
router.post('/v1/media/*path', ...mediaAddPermission);
router.patch('/v1/media/*path', ...mediaUpdatePermission);
router.delete('/v1/media/*path', ...mediaRemovePermission);


// Track activity (segment plays) — manual route outside OpenAPI-generated router
router.post('/v1/user/activity', async (req: any, res: any, next: any) => {
  try {
    const user = req.user;
    if (!user) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    const { activityType, segmentUuid, mediaId, animeName, japaneseText } = req.body ?? {};
    if (activityType !== ActivityType.SEGMENT_PLAY) {
      return res.status(400).json({ message: 'Only SEGMENT_PLAY tracking is supported via this endpoint.' });
    }

    trackActivity(user, ActivityType.SEGMENT_PLAY, {
      segmentUuid: typeof segmentUuid === 'string' ? segmentUuid : undefined,
      mediaId: typeof mediaId === 'number' ? mediaId : undefined,
      animeName: typeof animeName === 'string' ? animeName : undefined,
      japaneseText: typeof japaneseText === 'string' ? japaneseText : undefined,
    }).catch(() => {});

    return res.status(204).end();
  } catch (error) {
    next(error);
  }
});

// Delete all activity for a specific date
router.delete('/v1/user/activity/date/:date', async (req: any, res: any, next: any) => {
  try {
    const user = req.user;
    if (!user) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    const date = req.params.date;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ message: 'Invalid date format. Use YYYY-MM-DD.' });
    }

    const result = await UserActivity.createQueryBuilder()
      .delete()
      .where('user_id = :userId', { userId: user.id })
      .andWhere('DATE(created_at) = :date', { date })
      .execute();

    return res.status(200).json({ deletedCount: result.affected || 0 });
  } catch (error) {
    next(error);
  }
});

// Delete a single activity row by ID
router.delete('/v1/user/activity/:id', async (req: any, res: any, next: any) => {
  try {
    const user = req.user;
    if (!user) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ message: 'Invalid activity ID.' });
    }

    const result = await UserActivity.delete({ id, userId: user.id });
    if (!result.affected) {
      return res.status(404).json({ message: 'Activity not found.' });
    }

    return res.status(204).end();
  } catch (error) {
    next(error);
  }
});

router.use('/', SearchRoutes);
router.use('/', MediaRoutes);
router.use('/', CollectionsRoutes);
router.use('/', AdminRoutes);
router.use('/', UserRoutes);

export { router };
