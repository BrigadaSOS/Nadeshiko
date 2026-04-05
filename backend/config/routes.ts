import express, {
  type Application,
  type NextFunction,
  type Request,
  type RequestHandler,
  type Response,
} from 'express';
import { toNodeHandler } from 'better-auth/node';
import { auth } from '@config/auth';
import { requireSession, enforceAdminAccess } from '@app/middleware/routePolicies';
import { routeAuth } from 'generated/routeAuth';
import { invalidateAuthCachesAfterMutation } from '@app/middleware/authCacheInvalidation';
import { search, getSearchStats, searchWords } from '@app/controllers/searchController';
import { getAdminHealth, getAdminDashboard, triggerReindex } from '@app/controllers/adminController';
import {
  getAdminDashboardOverview,
  getAdminDashboardMedia,
  getAdminDashboardActivity,
  getAdminDashboardCollections,
  getAdminDashboardApiKeys,
  getAdminDashboardSystem,
  getAdminUsersWithProviders,
} from '@app/controllers/adminDashboardController';
import {
  listAdminQueueStats,
  getAdminQueue,
  retryAdminQueueFailed,
  listAdminQueueFailed,
  purgeAdminQueueFailed,
} from '@app/controllers/queueController';
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
import {
  createUserReport,
  listAdminReports,
  updateAdminReport,
  batchUpdateAdminReports,
} from '@app/controllers/reportController';
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
import { getStatsOverview, getCoveredWords, triggerCoveredWordsUpdate } from '@app/controllers/statsController';
import { createRouter as createSearchRouter } from 'generated/routes/search';
import { createRouter as createMediaRouter } from 'generated/routes/media';
import { createRouter as createCollectionsRouter } from 'generated/routes/collections';
import { createRouter as createAdminRouter } from 'generated/routes/admin';
import { createRouter as createUserRouter } from 'generated/routes/user';
import { createRouter as createStatsRouter } from 'generated/routes/stats';

export const noCache = (_req: Request, res: Response, next: NextFunction) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('CDN-Cache-Control', 'no-store');
  next();
};

const magicLinkBanRedirect: RequestHandler = (req, res, next) => {
  const originalEnd = res.end.bind(res);
  (res.end as any) = (chunk?: any, encoding?: any, callback?: any) => {
    if (res.statusCode === 403 && chunk) {
      try {
        const str = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
        const body = JSON.parse(str);
        if (body?.code === 'BANNED_USER') {
          const callbackURL = (req.query.callbackURL as string) || '/';
          const sep = callbackURL.includes('?') ? '&' : '?';
          res.end = originalEnd;
          res.statusCode = 302;
          res.removeHeader('Content-Type');
          res.setHeader('Location', `${callbackURL}${sep}error=banned`);
          return originalEnd.call(res, '');
        }
      } catch {}
    }
    return originalEnd.call(res, chunk, encoding, callback);
  };
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
  getAdminDashboardOverview,
  getAdminDashboardMedia,
  getAdminDashboardActivity,
  getAdminDashboardCollections,
  getAdminDashboardApiKeys,
  getAdminDashboardSystem,
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
  getAnnouncement,
  updateAnnouncement,
});

const StatsRoutes = createStatsRouter({
  getStatsOverview,
  getCoveredWords,
  triggerCoveredWordsUpdate,
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

const router = express.Router();

for (const { method, path, middleware } of routeAuth) {
  router[method as 'get' | 'post' | 'patch' | 'put' | 'delete'](path, middleware);
}

router.use('/', SearchRoutes);
router.use('/', StatsRoutes);
router.use('/', MediaRoutes);
router.use('/', CollectionsRoutes);
router.use('/', AdminRoutes);
router.use('/', UserRoutes);

router.get('/v1/admin/users-with-providers', requireSession(enforceAdminAccess), getAdminUsersWithProviders);

export function mountRoutes(app: Application): Application {
  app.get('/up', (_req, res) => res.status(200).send('OK'));

  app.all(
    '/v1/auth/magic-link/verify',
    noCache,
    magicLinkBanRedirect,
    invalidateAuthCachesAfterMutation,
    toNodeHandler(auth),
  );
  app.all('/v1/auth', noCache, invalidateAuthCachesAfterMutation, toNodeHandler(auth));
  app.all('/v1/auth/*splat', noCache, invalidateAuthCachesAfterMutation, toNodeHandler(auth));
  app.use('/', router);
  return app;
}

export { router, MediaRoutes, SearchRoutes, StatsRoutes, CollectionsRoutes, AdminRoutes, UserRoutes };
