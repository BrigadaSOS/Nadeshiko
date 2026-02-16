import express from 'express';
import { requireApiKeyAuth, requireSessionAuth } from '@app/middleware/authentication';
import { AuthType } from '@app/models/ApiPermission';
import { requirePermissions } from '@app/middleware/authorization';
import { ApiPermission } from '@app/models/ApiPermission';
import { rateLimitApiQuota } from '@app/middleware/apiLimiterQuota';
import { InsufficientPermissionsError } from '@app/errors';
import { searchIndex, searchStats, searchWords } from '@app/controllers/searchController';
import { adminHealthShow } from '@app/controllers/adminHealthController';
import { adminDashboardShow } from '@app/controllers/adminDashboardController';
import {
  adminReindexCreate,
  adminQueueStatsIndex,
  adminQueueShow,
  adminQueueRetryCreate,
  adminQueueFailedIndex,
  adminQueueFailedDestroy,
} from '@app/controllers/adminController';
import { impersonateUserForDevelopment, clearDevelopmentImpersonation } from '@app/controllers/devAuthController';
import { isLocalEnvironment } from '@config/environment';
import { mediaIndex, mediaCreate, mediaShow, mediaUpdate, mediaDestroy } from '@app/controllers/mediaController';
import { characterShow } from '@app/controllers/characterController';
import { seiyuuShow } from '@app/controllers/seiyuuController';
import {
  collectionIndex,
  collectionShow,
  collectionCreate,
  collectionUpdate,
  collectionDestroy,
  collectionAddSegment,
  collectionUpdateSegment,
  collectionRemoveSegment,
} from '@app/controllers/collectionController';
import {
  seriesIndex,
  seriesShow,
  seriesCreate,
  seriesUpdate,
  seriesDestroy,
  seriesAddMedia,
  seriesUpdateMedia,
  seriesRemoveMedia,
} from '@app/controllers/seriesController';
import {
  episodeIndex,
  episodeCreate,
  episodeShow,
  episodeUpdate,
  episodeDestroy,
} from '@app/controllers/episodeController';
import {
  segmentIndex,
  segmentCreate,
  segmentShow,
  segmentUpdate,
  segmentDestroy,
  segmentShowByUuid,
  segmentContextShow,
} from '@app/controllers/segmentController';
import { userQuotaShow } from '@app/controllers/userQuotaController';
import {
  userReportCreate,
  userReportIndex,
  adminReportIndex,
  adminReportUpdate,
} from '@app/controllers/reportController';
import { userPreferencesShow, userPreferencesUpdate } from '@app/controllers/preferencesController';
import { userLabsIndex } from '@app/controllers/labsController';
import {
  userActivityIndex,
  userActivityHeatmapShow,
  userActivityStatsShow,
  userActivityDestroy,
} from '@app/controllers/activityController';
import { userExportShow } from '@app/controllers/userExportController';
import {
  adminReviewRunCreate,
  adminReviewCheckIndex,
  adminReviewCheckUpdate,
  adminReviewRunIndex,
  adminReviewRunShow,
  adminReviewAllowlistIndex,
  adminReviewAllowlistCreate,
  adminReviewAllowlistDestroy,
} from '@app/controllers/mediaReviewController';
import { createRouter as createSearchRouter } from 'generated/routes/search';
import { createRouter as createMediaRouter } from 'generated/routes/media';
import { createRouter as createCollectionsRouter } from 'generated/routes/collections';
import { createRouter as createAdminRouter } from 'generated/routes/admin';
import { createRouter as createUserRouter } from 'generated/routes/user';

const router = express.Router();

const SearchRoutes = createSearchRouter({
  searchIndex,
  searchStats,
  searchWords,
});

const MediaRoutes = createMediaRouter({
  mediaIndex,
  mediaCreate,
  mediaShow,
  mediaUpdate,
  mediaDestroy,
  characterShow,
  seiyuuShow,
  episodeIndex,
  episodeCreate,
  episodeShow,
  episodeUpdate,
  episodeDestroy,
  segmentIndex,
  segmentCreate,
  segmentShow,
  segmentUpdate,
  segmentDestroy,
  segmentShowByUuid,
  segmentContextShow,
  seriesIndex,
  seriesShow,
  seriesCreate,
  seriesUpdate,
  seriesDestroy,
  seriesAddMedia,
  seriesUpdateMedia,
  seriesRemoveMedia,
});

const CollectionsRoutes = createCollectionsRouter({
  collectionIndex,
  collectionCreate,
  collectionShow,
  collectionUpdate,
  collectionDestroy,
  collectionAddSegment,
  collectionUpdateSegment,
  collectionRemoveSegment,
});

const AdminRoutes = createAdminRouter({
  adminDashboardShow,
  adminHealthShow,
  adminReindexCreate,
  adminQueueStatsIndex,
  adminQueueShow,
  adminQueueFailedIndex,
  adminQueueFailedDestroy,
  adminQueueRetryCreate,
  adminReportIndex,
  adminReportUpdate,
  adminReviewRunCreate,
  adminReviewCheckIndex,
  adminReviewCheckUpdate,
  adminReviewRunIndex,
  adminReviewRunShow,
  adminReviewAllowlistIndex,
  adminReviewAllowlistCreate,
  adminReviewAllowlistDestroy,
});

const UserRoutes = createUserRouter({
  userQuotaShow,
  userReportCreate,
  userReportIndex,
  userPreferencesShow,
  userPreferencesUpdate,
  userActivityIndex,
  userActivityHeatmapShow,
  userActivityDestroy,
  userActivityStatsShow,
  userExportShow,
  userLabsIndex,
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

router.use('/', SearchRoutes);
router.use('/', MediaRoutes);
router.use('/', CollectionsRoutes);
router.use('/', AdminRoutes);
router.use('/', UserRoutes);

export { router };
