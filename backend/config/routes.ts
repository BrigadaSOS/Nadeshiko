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
import { AppDataSource } from '@config/database';
import { client as elasticsearchClient } from '@config/elasticsearch';
import { routeAuth } from 'generated/routeAuth';
import { invalidateAuthCachesAfterMutation } from '@app/middleware/authCacheInvalidation';
import {
  authRateLimit,
  feedbackRateLimit,
  signInAddressRateLimit,
  signInGlobalRateLimit,
  unsubscribeRateLimit,
} from '@app/middleware/rateLimit';
import { createInFlightLimit } from '@app/middleware/inFlightLimit';
import { loginCodeBinding } from '@app/middleware/loginCodeBinding';
import { APP_ENVIRONMENT, getAppEnvironment } from '@config/environment';
import { config } from '@config/config';
import { search, getSearchStats, searchWords } from '@app/controllers/searchController';
import { getAdminUsersWithProviders } from '@app/controllers/adminDashboardController';
import { handleZeptomailWebhook, WEBHOOK_ZEPTOMAIL_PATH } from '@app/controllers/webhooks/zeptomailController';
import { listTiers, getAdminUserQuota, updateAdminUserQuota } from '@app/controllers/adminQuotaController';
import { getAnnouncement, updateAnnouncement } from '@app/controllers/announcementController';
import { listAgentActivity } from '@app/controllers/agentActivityController';
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
  restoreSegmentRevision,
  moderateEpisodeSegments,
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
import { createFeedback, getFeedbackFormToken } from '@app/controllers/feedbackController';
import {
  getEmailPreferencesByToken,
  handleEmailLinkClick,
  unsubscribeFromEmail,
  updateEmailPreferencesByToken,
} from '@app/controllers/emailController';
import { EMAIL_LINK_PATH } from '@app/services/email/returnLink';
import { getUserPreferences, updateUserPreferences } from '@app/controllers/preferencesController';
import {
  listUserActivity,
  getUserActivityHeatmap,
  getUserActivityStats,
  deleteUserActivity,
  trackUserActivity,
  deleteUserActivityByDate,
  deleteUserActivityById,
} from '@app/controllers/activityController';
import {
  getMe,
  listExcludedMedia,
  addExcludedMedia,
  removeExcludedMedia,
  listFavoriteMedia,
  addFavoriteMedia,
  removeFavoriteMedia,
} from '@app/controllers/userController';
import { createUserApiKey } from '@app/controllers/apiKeyController';
import {
  getShirabeConnection,
  startShirabeLink,
  completeShirabeLink,
  unlinkShirabe,
  getShirabeCredential,
  resyncShirabeStack,
  reportShirabeRefusal,
} from '@app/controllers/shirabeConnectionController';
import { listFamiliarMedia, clearFamiliarMedia, forgetFamiliarMedia } from '@app/controllers/familiarMediaController';
import { exportUserData } from '@app/controllers/userExportController';
import {
  completePatreonLink,
  getPatreonConnection,
  startPatreonLink,
  unlinkPatreon,
} from '@app/controllers/patreonConnectionController';
import {
  createAdminRoadmapItem,
  createRoadmapProposal,
  listAdminRoadmap,
  listRoadmap,
  updateAdminRoadmapItem,
} from '@app/controllers/roadmapController';
import { getStatsOverview, getCoveredWords, triggerCoveredWordsUpdate } from '@app/controllers/statsController';
import { createRouter as createSearchRouter } from 'generated/routes/search';
import { createRouter as createMediaRouter } from 'generated/routes/media';
import { createRouter as createCollectionsRouter } from 'generated/routes/collections';
import { createRouter as createAdminRouter } from 'generated/routes/admin';
import { createRouter as createActivityRouter } from 'generated/routes/activity';
import { createRouter as createUserRouter } from 'generated/routes/user';
import { createRouter as createFeedbackRouter } from 'generated/routes/feedback';
import { createRouter as createEmailRouter } from 'generated/routes/email';
import { createRouter as createStatsRouter } from 'generated/routes/stats';
import { createRouter as createRoadmapRouter } from 'generated/routes/roadmap';

export const noCache = (_req: Request, res: Response, next: NextFunction) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('CDN-Cache-Control', 'no-store');
  next();
};

// `/up` serves deploy and health probes: cache and bound it. Postgres failure is 503/rollback-worthy; Elasticsearch is
// reported soft so a search outage does not restart the whole API.
const HEALTH_CACHE_MS = 5_000;
const HEALTH_PROBE_TIMEOUT_MS = 2_000;

interface HealthSnapshot {
  database: boolean;
  elasticsearch: boolean;
}

let cachedHealth: { at: number; snapshot: HealthSnapshot } | null = null;
let inFlightHealth: Promise<HealthSnapshot> | null = null;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('health probe timed out')), ms);
    promise.then(resolve, reject).finally(() => clearTimeout(timer));
  });
}

async function probeDatabase(): Promise<boolean> {
  if (!AppDataSource.isInitialized) return false;
  await AppDataSource.query('SELECT 1');
  return true;
}

async function probeElasticsearch(): Promise<boolean> {
  return elasticsearchClient.ping({}, { requestTimeout: HEALTH_PROBE_TIMEOUT_MS, maxRetries: 0 });
}

function checkHealth(): Promise<HealthSnapshot> {
  const now = Date.now();
  if (cachedHealth && now - cachedHealth.at < HEALTH_CACHE_MS) return Promise.resolve(cachedHealth.snapshot);
  if (inFlightHealth) return inFlightHealth;

  inFlightHealth = Promise.all([
    withTimeout(probeDatabase(), HEALTH_PROBE_TIMEOUT_MS).catch(() => false),
    withTimeout(probeElasticsearch(), HEALTH_PROBE_TIMEOUT_MS).catch(() => false),
  ])
    .then(([database, elasticsearch]) => {
      const snapshot: HealthSnapshot = { database, elasticsearch };
      cachedHealth = { at: Date.now(), snapshot };
      return snapshot;
    })
    .finally(() => {
      inFlightHealth = null;
    });

  return inFlightHealth;
}

const healthCheck: RequestHandler = async (_req, res) => {
  const { database, elasticsearch } = await checkHealth();
  res.status(database ? 200 : 503).json({
    status: database ? 'ok' : 'error',
    database: database ? 'up' : 'down',
    elasticsearch: elasticsearch ? 'up' : 'down',
    releaseSha: config.RELEASE_SHA,
  });
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
          return originalEnd('');
        }
      } catch {
        // Non-JSON/ordinary successful auth responses are not the banned-user shape; leave them unchanged.
      }
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
  restoreSegmentRevision,
  moderateEpisodeSegments,
});

const ActivityRoutes = createActivityRouter({
  listUserActivity,
  getUserActivityHeatmap,
  getUserActivityStats,
  listFamiliarMedia,
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
  listAdminReports,
  batchUpdateAdminReports,
  bulkUpdateAdminReports,
  bulkDeleteAdminReports,
  updateAdminReport,
  deleteAdminReport,
  listAgentActivity,
  getAnnouncement,
  updateAnnouncement,
  getAdminUsersWithProviders,
  listTiers,
  getAdminUserQuota,
  updateAdminUserQuota,
  listAdminRoadmap,
  createAdminRoadmapItem,
  updateAdminRoadmapItem,
});

const FeedbackRoutes = createFeedbackRouter({
  createFeedback,
  getFeedbackFormToken,
});

const EmailRoutes = createEmailRouter({
  unsubscribeFromEmail,
  getEmailPreferencesByToken,
  updateEmailPreferencesByToken,
});

const StatsRoutes = createStatsRouter({
  getStatsOverview,
  getCoveredWords,
  triggerCoveredWordsUpdate,
});

const RoadmapRoutes = createRoadmapRouter({ listRoadmap, createRoadmapProposal });

const UserRoutes = createUserRouter({
  getMe,
  createUserApiKey,
  getShirabeConnection,
  startShirabeLink,
  completeShirabeLink,
  unlinkShirabe,
  getShirabeCredential,
  resyncShirabeStack,
  reportShirabeRefusal,
  getPatreonConnection,
  startPatreonLink,
  completePatreonLink,
  unlinkPatreon,
  listExcludedMedia,
  addExcludedMedia,
  removeExcludedMedia,
  listFavoriteMedia,
  addFavoriteMedia,
  removeFavoriteMedia,
  clearFamiliarMedia,
  forgetFamiliarMedia,
  createUserReport,
  getUserPreferences,
  updateUserPreferences,
  deleteUserActivity,
  trackUserActivity,
  deleteUserActivityByDate,
  deleteUserActivityById,
  exportUserData,
});

const router = express.Router();

/** Publish the route template directly because Express instrumentation is a no-op on this ESM setup; otherwise
 * segment URLs have no bounded `http.route`. PostgreSQL instrumentation is unaffected. */
const setRouteTemplate =
  (path: string): RequestHandler =>
  (_req, _res, next) => {
    const rpcMetadata = getRPCMetadata(otelContext.active());
    if (rpcMetadata?.type === RPCType.HTTP) {
      rpcMetadata.route = path;
    }
    next();
  };

/** Collapse unknown `/v1/auth` paths to a known route set: raw paths on this unauthenticated surface allow unbounded
 * metric cardinality. Missing entries lose visibility, not safety; source them alongside the SDK auth spec. */
const AUTH_ROUTES: ReadonlySet<string> = new Set([
  '/v1/auth',
  '/v1/auth/admin/ban-user',
  '/v1/auth/admin/impersonate-user',
  '/v1/auth/admin/stop-impersonating',
  '/v1/auth/admin/unban-user',
  '/v1/auth/api-key/create',
  '/v1/auth/api-key/list',
  '/v1/auth/api-key/update',
  '/v1/auth/change-email',
  '/v1/auth/delete-user',
  '/v1/auth/get-session',
  '/v1/auth/list-sessions',
  '/v1/auth/magic-link/verify',
  '/v1/auth/revoke-other-sessions',
  '/v1/auth/revoke-session',
  '/v1/auth/revoke-sessions',
  '/v1/auth/sign-in/email-otp',
  '/v1/auth/sign-in/magic-link',
  '/v1/auth/sign-in/social',
  '/v1/auth/sign-out',
]);

// Routes with a variable segment, templated rather than listed.
const AUTH_ROUTE_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  [/^\/v1\/auth\/callback\/[^/]+$/, '/v1/auth/callback/:provider'],
];

export function authRouteLabel(path: string): string {
  if (AUTH_ROUTES.has(path)) return path;
  for (const [pattern, template] of AUTH_ROUTE_PATTERNS) {
    if (pattern.test(path)) return template;
  }
  return '/v1/auth/*';
}

const setAuthRoute: RequestHandler = (req, _res, next) => {
  const rpcMetadata = getRPCMetadata(otelContext.active());
  if (rpcMetadata?.type === RPCType.HTTP) {
    rpcMetadata.route = authRouteLabel(req.path.split('?')[0] ?? req.path);
  }
  next();
};

for (const { method, path, middleware } of routeAuth) {
  router[method as 'get' | 'post' | 'patch' | 'put' | 'delete'](path, setRouteTemplate(path), middleware);
}

// Label public no-security routes directly; feedback gets a local limiter here because direct API callers bypass the
// frontend limiter.
router.get('/v1/admin/announcement', setRouteTemplate('/v1/admin/announcement'));
router.get('/v1/roadmap', setRouteTemplate('/v1/roadmap'));
router.post('/v1/feedback', setRouteTemplate('/v1/feedback'), feedbackRateLimit);
router.get('/v1/feedback/token', setRouteTemplate('/v1/feedback/token'), feedbackRateLimit);
router.post('/v1/email/unsubscribe', setRouteTemplate('/v1/email/unsubscribe'), unsubscribeRateLimit);
// Keep preference/unsubscribe links on the same token limit; tokens are not secrets once forwarded.
router.get('/v1/email/preferences', setRouteTemplate('/v1/email/preferences'), unsubscribeRateLimit);
router.patch('/v1/email/preferences', setRouteTemplate('/v1/email/preferences'), unsubscribeRateLimit);

// Apply the search in-flight cap after auth and before the router so unauthorized requests do not consume slots and
// direct callers still have an admission limit.
const searchInFlightLimit = createInFlightLimit({ scope: 'search', max: config.SEARCH_MAX_INFLIGHT });
router.post(['/v1/search', '/v1/search/stats'], searchInFlightLimit);

router.use('/', SearchRoutes);
router.use('/', StatsRoutes);
router.use('/', RoadmapRoutes);
router.use('/', MediaRoutes);
router.use('/', ActivityRoutes);
router.use('/', CollectionsRoutes);
router.use('/', AdminRoutes);
router.use('/', UserRoutes);
router.use('/', FeedbackRoutes);
router.use('/', EmailRoutes);

// Keep the exact-body HMAC callback outside session auth; undocumented provider retries mean 429s may lose events.
// Redirects need `noCache` to prevent cross-recipient leaks and only the global limiter, since scanners share reader
// egress addresses.
router.get(EMAIL_LINK_PATH, noCache, setRouteTemplate(EMAIL_LINK_PATH), handleEmailLinkClick);

router.post(WEBHOOK_ZEPTOMAIL_PATH, noCache, setRouteTemplate(WEBHOOK_ZEPTOMAIL_PATH), handleZeptomailWebhook);

export function mountRoutes(app: Application): Application {
  app.get('/up', noCache, healthCheck);

  // Tighter per-IP limit on the auth surface (scoped before the auth handlers).
  app.use('/v1/auth', authRateLimit);

  // Bind sign-in codes to the requesting browser before better-auth counts failed attempts.
  app.use(loginCodeBinding);

  // Mount address limiting before the application ceiling and keep both out of local routes. The order prevents garbage
  // requests from draining the global mail budget; both return 429 with `Retry-After`.
  if (getAppEnvironment(config.ENVIRONMENT) !== APP_ENVIRONMENT.LOCAL) {
    app.post('/v1/auth/sign-in/magic-link', signInAddressRateLimit, signInGlobalRateLimit);
  }

  app.all(
    '/v1/auth/magic-link/verify',
    noCache,
    setRouteTemplate('/v1/auth/magic-link/verify'),
    magicLinkBanRedirect,
    invalidateAuthCachesAfterMutation,
    toNodeHandler(auth),
  );
  app.all('/v1/auth', noCache, setRouteTemplate('/v1/auth'), invalidateAuthCachesAfterMutation, toNodeHandler(auth));
  app.all('/v1/auth/*splat', noCache, setAuthRoute, invalidateAuthCachesAfterMutation, toNodeHandler(auth));
  app.use('/', router);
  return app;
}

export {
  router,
  MediaRoutes,
  SearchRoutes,
  StatsRoutes,
  RoadmapRoutes,
  ActivityRoutes,
  CollectionsRoutes,
  AdminRoutes,
  UserRoutes,
  FeedbackRoutes,
  EmailRoutes,
};
