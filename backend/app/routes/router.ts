import express from 'express';
import { requireApiKeyAuth, requireSessionAuth } from '@app/middleware/authentication';
import { AuthType } from '@app/models/ApiPermission';
import { requirePermissions } from '@app/middleware/authorization';
import { ApiPermission } from '@app/models/ApiPermission';
import { rateLimitApiQuota } from '@app/middleware/apiLimiterQuota';
import {
  healthCheck,
  searchSegments,
  getSearchStats,
  searchWords,
  getSegmentContext,
  browseMedia,
} from '@app/controllers/searchController';
import {
  reindexElasticsearch,
  getQueueStats,
  getQueueDetails,
  retryQueueJobs,
  getFailedJobs,
  purgeFailedJobs,
  morphemeBackfill,
} from '@app/controllers/adminController';
import { impersonateUserForDevelopment, clearDevelopmentImpersonation } from '@app/controllers/devAuthController';
import { isLocalEnvironment } from '@config/environment';
import { mediaIndex, mediaCreate, mediaShow, mediaUpdate, mediaDestroy } from '@app/controllers/mediaController';
import { characterShow } from '@app/controllers/characterController';
import { seiyuuShow } from '@app/controllers/seiyuuController';
import {
  listIndex,
  listShow,
  listCreate,
  listUpdate,
  listDestroy,
  listAddItem,
  listUpdateItem,
  listRemoveItem,
  listGetSegments,
  listAddSegment,
  listUpdateSegment,
  listRemoveSegment,
} from '@app/controllers/listController';
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
} from '@app/controllers/segmentController';
import { getUserQuota } from '@app/controllers/userQuotaController';
import { createReport, getUserReports, getAdminReports, updateReport } from '@app/controllers/reportController';
import { createRouter as createSearchRouter } from 'generated/routes/search';
import { createRouter as createMediaRouter } from 'generated/routes/media';
import { createRouter as createListsRouter } from 'generated/routes/lists';
import { createRouter as createAdminRouter } from 'generated/routes/admin';
import { createRouter as createUserRouter } from 'generated/routes/user';

const router = express.Router();

const SearchRoutes = createSearchRouter({
  healthCheck,
  searchSegments,
  getSearchStats,
  searchWords,
  getSegmentContext,
  browseMedia,
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
});

const ListsRoutes = createListsRouter({
  listIndex,
  listCreate,
  listShow,
  listUpdate,
  listDestroy,
  listAddItem,
  listUpdateItem,
  listRemoveItem,
  listGetSegments,
  listAddSegment,
  listUpdateSegment,
  listRemoveSegment,
});

const AdminRoutes = createAdminRouter({
  reindexElasticsearch,
  getQueueStats,
  getQueueDetails,
  getFailedJobs,
  purgeFailedJobs,
  retryQueueJobs,
  morphemeBackfill,
  getAdminReports,
  updateReport,
});

const UserRoutes = createUserRouter({
  getUserQuota,
  createReport,
  getUserReports,
});

const apiKeyOnly = [requireApiKeyAuth, rateLimitApiQuota] as const;

const searchAccess = [requireApiKeyAuth, requirePermissions(ApiPermission.READ_MEDIA), rateLimitApiQuota] as const;
const adminAccess = [requireApiKeyAuth, requirePermissions(ApiPermission.ADD_MEDIA), rateLimitApiQuota] as const;

const mediaReadPermission = [requirePermissions(ApiPermission.READ_MEDIA)] as const;
const mediaAddPermission = [requirePermissions(ApiPermission.ADD_MEDIA)] as const;
const mediaUpdatePermission = [requirePermissions(ApiPermission.UPDATE_MEDIA)] as const;
const mediaRemovePermission = [requirePermissions(ApiPermission.REMOVE_MEDIA)] as const;

const listsReadPermission = [requirePermissions(ApiPermission.READ_LISTS)] as const;
const listsCreatePermission = [requirePermissions(ApiPermission.CREATE_LISTS)] as const;
const listsUpdatePermission = [requirePermissions(ApiPermission.UPDATE_LISTS)] as const;
const listsDeletePermission = [requirePermissions(ApiPermission.DELETE_LISTS)] as const;

if (isLocalEnvironment()) {
  router.post('/v1/dev/auth/impersonate', impersonateUserForDevelopment);
  router.post('/v1/dev/auth/impersonate/clear', clearDevelopmentImpersonation);
}
router.use('/v1/user', requireSessionAuth);

router.use('/v1/search', ...searchAccess);
router.use('/v1/admin', ...adminAccess);
router.use('/v1/media', ...apiKeyOnly);
// Lists support both API key and session auth
const requireApiKeyOrSession = async (req: any, res: any, next: any) => {
  const hasBearer = req.headers.authorization?.startsWith('Bearer ');
  if (hasBearer) {
    return requireApiKeyAuth(req, res, next);
  }
  return requireSessionAuth(req, res, next);
};
router.use('/v1/lists', requireApiKeyOrSession);
router.use('/v1/lists', (req: any, _res: any, next: any) => {
  // Only apply rate limiting for API key auth
  if (req.auth?.type !== AuthType.SESSION) {
    return rateLimitApiQuota(req, _res, next);
  }
  next();
});

router.get('/v1/media', ...mediaReadPermission);
router.get('/v1/media/*path', ...mediaReadPermission);
router.post('/v1/media/*path', ...mediaAddPermission);
router.patch('/v1/media/*path', ...mediaUpdatePermission);
router.delete('/v1/media/*path', ...mediaRemovePermission);

router.get('/v1/lists', ...listsReadPermission);
router.get('/v1/lists/*path', ...listsReadPermission);
router.post('/v1/lists/*path', ...listsCreatePermission);
router.patch('/v1/lists/*path', ...listsUpdatePermission);
router.delete('/v1/lists/*path', ...listsDeletePermission);

router.use('/', SearchRoutes);
router.use('/', MediaRoutes);
router.use('/', ListsRoutes);
router.use('/', AdminRoutes);
router.use('/', UserRoutes);

export { router };
