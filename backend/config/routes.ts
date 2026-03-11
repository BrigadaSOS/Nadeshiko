import express, {
  type Application,
  type NextFunction,
  type Request,
  type RequestHandler,
  type Response,
} from 'express';
import { toNodeHandler } from 'better-auth/node';
import { auth } from '@config/auth';
import { AccessDeniedError } from '@app/errors';
import { routeAuth } from 'generated/routeAuth';
import { isLocalEnvironment } from '@config/environment';
import { invalidateAuthCachesAfterMutation } from '@app/middleware/authCacheInvalidation';
import { search, getSearchStats, searchWords } from '@app/controllers/searchController';
import { getAdminHealth, getAdminDashboard, triggerReindex } from '@app/controllers/adminController';
import {
  listAdminQueueStats,
  getAdminQueue,
  retryAdminQueueFailed,
  listAdminQueueFailed,
  purgeAdminQueueFailed,
} from '@app/controllers/queueController';
import { impersonateAdminUser, clearAdminImpersonation } from '@app/controllers/devAuthController';
import { getAnnouncement, updateAnnouncement } from '@app/controllers/announcementController';
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
  searchCollectionSegments,
  getCollectionStats,
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
  createSegmentsBatch,
  getSegment,
  updateSegment,
  deleteSegment,
  getSegmentByUuid,
  getSegmentContext,
  updateSegmentByUuid,
  listSegmentRevisions,
} from '@app/controllers/segmentController';
import { getUserQuota } from '@app/controllers/userQuotaController';
import { createUserReport, listAdminReports, updateAdminReport, batchUpdateAdminReports } from '@app/controllers/reportController';
import { getUserPreferences, updateUserPreferences } from '@app/controllers/preferencesController';
import { listUserLabs, enrollUserLab, unenrollUserLab } from '@app/controllers/labsController';
import {
  listUserActivity,
  getUserActivityHeatmap,
  getUserActivityStats,
  deleteUserActivity,
  trackUserActivity,
  deleteUserActivityByDate,
  deleteUserActivityById,
} from '@app/controllers/activityController';
import { exportUserData } from '@app/controllers/userExportController';
import {
  listAdminMediaAudits,
  updateAdminMediaAudit,
  runAdminMediaAudit,
  listAdminMediaAuditRuns,
  getAdminMediaAuditRun,
} from '@app/controllers/mediaAuditController';
import { createRouter as createSearchRouter } from 'generated/routes/search';
import { createRouter as createMediaRouter } from 'generated/routes/media';
import { createRouter as createCollectionsRouter } from 'generated/routes/collections';
import { createRouter as createAdminRouter } from 'generated/routes/admin';
import { createRouter as createUserRouter } from 'generated/routes/user';

export const noCache = (_req: Request, res: Response, next: NextFunction) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('CDN-Cache-Control', 'no-store');
  next();
};

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
  createSegmentsBatch,
  getSegment,
  updateSegment,
  deleteSegment,
  getSegmentByUuid,
  getSegmentContext,
  updateSegmentByUuid,
  listSegmentRevisions,
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
  searchCollectionSegments,
  getCollectionStats,
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
  batchUpdateAdminReports,
  updateAdminReport,
  listAdminMediaAudits,
  updateAdminMediaAudit,
  runAdminMediaAudit,
  listAdminMediaAuditRuns,
  getAdminMediaAuditRun,
  impersonateAdminUser,
  clearAdminImpersonation,
  getAnnouncement,
  updateAnnouncement,
});

const UserRoutes = createUserRouter({
  getUserQuota,
  createUserReport,
  getUserPreferences,
  updateUserPreferences,
  listUserActivity,
  deleteUserActivity,
  trackUserActivity,
  deleteUserActivityByDate,
  deleteUserActivityById,
  getUserActivityHeatmap,
  getUserActivityStats,
  exportUserData,
  listUserLabs,
  enrollUserLab,
  unenrollUserLab,
});

const requireLocalEnvironmentOnly: RequestHandler = (_req, _res, next) => {
  if (!isLocalEnvironment()) {
    throw new AccessDeniedError('Development impersonation is only available in local environment.');
  }

  next();
};

const router = express.Router();

router.use('/v1/admin/impersonation', requireLocalEnvironmentOnly);

for (const { method, path, middleware } of routeAuth) {
  router[method as 'get' | 'post' | 'patch' | 'put' | 'delete'](path, middleware);
}

router.use('/', SearchRoutes);
router.use('/', MediaRoutes);
router.use('/', CollectionsRoutes);
router.use('/', AdminRoutes);
router.use('/', UserRoutes);

export function mountRoutes(app: Application): Application {
  app.get('/up', (_req, res) => res.status(200).send('OK'));

  app.get('/debug-sentry', () => {
    throw new Error('Sentry test error');
  });

  app.all('/v1/auth', noCache, invalidateAuthCachesAfterMutation, toNodeHandler(auth));
  app.all('/v1/auth/*splat', noCache, invalidateAuthCachesAfterMutation, toNodeHandler(auth));
  app.use('/', router);
  return app;
}

export { router, MediaRoutes, SearchRoutes, CollectionsRoutes, AdminRoutes, UserRoutes };
