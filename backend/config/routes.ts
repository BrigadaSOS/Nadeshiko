import express, {
  type Application,
  type NextFunction,
  type Request,
  type RequestHandler,
  type Response,
} from 'express';
import { toNodeHandler } from 'better-auth/node';
import { getRPCMetadata, RPCType } from '@opentelemetry/core';
import { context as otelContext } from '@opentelemetry/api';
import { auth } from '@config/auth';
import { requireSession, enforceAdminAccess } from '@app/middleware/routePolicies';
import { routeAuth } from 'generated/routeAuth';
import { invalidateAuthCachesAfterMutation } from '@app/middleware/authCacheInvalidation';
import { search, getSearchStats, searchWords } from '@app/controllers/searchController';
import { triggerReindex } from '@app/controllers/adminController';
import { getAdminUsersWithProviders } from '@app/controllers/adminDashboardController';
import { getAnnouncement, updateAnnouncement } from '@app/controllers/announcementController';
import {
  listMedia,
  createMedia,
  getMedia,
  updateMedia,
  deleteMedia,
  searchMedia,
} from '@app/controllers/mediaController';
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
  getSegmentContext,
  updateSegment,
  listSegmentRevisions,
} from '@app/controllers/segmentController';
import {
  createUserReport,
  listAdminReports,
  updateAdminReport,
  deleteAdminReport,
  batchUpdateAdminReports,
  bulkUpdateAdminReports,
  bulkDeleteAdminReports,
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
import { getMe, listExcludedMedia, addExcludedMedia, removeExcludedMedia } from '@app/controllers/userController';
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
import { createRouter as createActivityRouter } from 'generated/routes/activity';
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
  searchMedia,
});

const MediaRoutes = createMediaRouter({
  listMedia,
  createMedia,
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
  getSegmentContext,
  updateSegment,
  listSegmentRevisions,
});

const ActivityRoutes = createActivityRouter({
  listUserActivity,
  getUserActivityHeatmap,
  getUserActivityStats,
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
  triggerReindex,
  listAdminReports,
  batchUpdateAdminReports,
  bulkUpdateAdminReports,
  bulkDeleteAdminReports,
  updateAdminReport,
  deleteAdminReport,
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
  getMe,
  listExcludedMedia,
  addExcludedMedia,
  removeExcludedMedia,
  createUserReport,
  getUserPreferences,
  updateUserPreferences,
  deleteUserActivity,
  trackUserActivity,
  deleteUserActivityByDate,
  deleteUserActivityById,
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
router.use('/', ActivityRoutes);
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
  const setAuthRoute: RequestHandler = (req, _res, next) => {
    const rpcMetadata = getRPCMetadata(otelContext.active());
    if (rpcMetadata?.type === RPCType.HTTP) {
      rpcMetadata.route = req.path.split('?')[0];
    }
    next();
  };
  app.all('/v1/auth', noCache, setAuthRoute, invalidateAuthCachesAfterMutation, toNodeHandler(auth));
  app.all('/v1/auth/*splat', noCache, setAuthRoute, invalidateAuthCachesAfterMutation, toNodeHandler(auth));
  app.use('/', router);
  return app;
}

export { router, MediaRoutes, SearchRoutes, StatsRoutes, ActivityRoutes, CollectionsRoutes, AdminRoutes, UserRoutes };
