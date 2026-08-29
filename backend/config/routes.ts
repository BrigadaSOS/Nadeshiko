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

export const noCache = (_req: Request, res: Response, next: NextFunction) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('CDN-Cache-Control', 'no-store');
  next();
};

// `/up` is what kamal-proxy polls (once a second) while a deploy is in flight
// and what the container HEALTHCHECK polls afterwards, so the probes are
// deduplicated, cached for a few seconds and hard-bounded in time.
//
// Postgres is a hard dependency: without it the API cannot serve anything, so a
// failed probe answers 503 and a bad deploy is rolled back instead of shipped.
// Elasticsearch is deliberately soft: only search degrades when it is down, and
// restart-looping the whole API over a search outage would turn a partial
// outage into a total one. Its state is reported as a field at 200 instead.
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
        // The body is not JSON, or not shaped like an error. That is the common
        // case -- every successful auth response lands here -- so it is not a
        // failure, it just means this is not the banned-user response we rewrite.
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

/**
 * Publish the route TEMPLATE (`/v1/media/segments/:segmentPublicId`) as
 * `http.route`, rather than letting the URL stand in for it.
 *
 * This is not belt-and-braces over the OTel express instrumentation -- it is
 * the only thing setting `http.route` on these routes. `package.json` declares
 * `"type": "module"`, so `import express from 'express'` resolves through the
 * ESM path, and @opentelemetry/instrumentation-express monkey-patches via
 * require-in-the-middle: verified on the host 2026-08-13, under `"type":
 * "module"` `express.Router.prototype.route.__wrapped` is false, and under CJS
 * it is true. Adding `@opentelemetry/instrumentation/hook.mjs` to the run
 * command does not fix it, in either load order. So the instrumentation is
 * silently a no-op here and 99.99% of requests reached the metrics with no
 * `http.route` at all, which left the APM "Endpoints" panel (it filters
 * `http_route!=""`) rendering next to nothing.
 *
 * pg is unaffected -- it patches through inner CommonJS requires and IS
 * wrapped under ESM -- so DB spans and metrics were never part of this.
 */
const setRouteTemplate =
  (path: string): RequestHandler =>
  (_req, _res, next) => {
    const rpcMetadata = getRPCMetadata(otelContext.active());
    if (rpcMetadata?.type === RPCType.HTTP) {
      rpcMetadata.route = path;
    }
    next();
  };

/**
 * The auth surface needs the same treatment, but it cannot name its route
 * statically: better-auth is mounted behind `app.all('/v1/auth/*splat')`, one
 * Express route standing in for every endpoint it serves.
 *
 * This used to publish `req.path` verbatim, which made `http.route` unbounded
 * on an UNAUTHENTICATED surface -- every distinct path under `/v1/auth` became
 * a permanent new metric series, so anything walking `/v1/auth/<random>` could
 * inflate cardinality at will. `authRateLimit` above caps the rate per IP, not
 * the number of distinct values that accumulate. The hazard was already
 * visible in miniature in production: `/v1/auth/callback/google` carried the
 * provider as a raw label value.
 *
 * So resolve against a known set instead and collapse the rest. An auth route
 * missing from this list costs VISIBILITY (it reports as `/v1/auth/*`), never
 * cardinality, which is why this does not need the kind of drift guard
 * `route-normalization.mjs` has -- failing closed is already the safe
 * direction. Sourced from the paths in docs/generated/openapi-sdk.yaml; extend
 * alongside EXPOSED_ROUTES in bin/generateAuthSpec.ts.
 */
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

// The routes with no security requirement, so they have no routeAuth entry to
// hang the template off. Label them directly.
//
// Feedback also picks up its own limiter here rather than relying on the global
// one: it is an unauthenticated write that sends mail, and this is the layer
// direct callers to `api.nadeshiko.co` arrive at. Site traffic is limited a hop
// earlier, at the Nitro proxy — see the note on `feedbackRateLimit`.
router.get('/v1/admin/announcement', setRouteTemplate('/v1/admin/announcement'));
router.post('/v1/feedback', setRouteTemplate('/v1/feedback'), feedbackRateLimit);
router.get('/v1/feedback/token', setRouteTemplate('/v1/feedback/token'), feedbackRateLimit);
router.post('/v1/email/unsubscribe', setRouteTemplate('/v1/email/unsubscribe'), unsubscribeRateLimit);
// The preference page's pair, held to the same limit as the one-click: all three
// are unauthenticated, all three are reachable by anybody who has a link, and a
// token is not a secret once it has been forwarded.
router.get('/v1/email/preferences', setRouteTemplate('/v1/email/preferences'), unsubscribeRateLimit);
router.patch('/v1/email/preferences', setRouteTemplate('/v1/email/preferences'), unsubscribeRateLimit);

// The two searches a page render fans out to, capped by how many can run at
// once rather than by who is asking -- see inFlightLimit for the 2026-08-30
// flood that made the distinction matter. Registered AFTER the routeAuth loop
// above, so an unauthenticated request is refused with a 401 before it can
// hold a slot, and BEFORE the router, so a refusal never reaches the handler.
// Site traffic is capped a hop earlier, at the frontend's render gate; this is
// the ceiling for direct API callers, which that gate cannot see.
const searchInFlightLimit = createInFlightLimit({ scope: 'search', max: config.SEARCH_MAX_INFLIGHT });
router.post(['/v1/search', '/v1/search/stats'], searchInFlightLimit);

router.use('/', SearchRoutes);
router.use('/', StatsRoutes);
router.use('/', MediaRoutes);
router.use('/', ActivityRoutes);
router.use('/', CollectionsRoutes);
router.use('/', AdminRoutes);
router.use('/', UserRoutes);
router.use('/', FeedbackRoutes);
router.use('/', EmailRoutes);

// The ZeptoMail bounce/complaint webhook.
//
// Registered by hand rather than generated, because it is a provider callback
// and not part of the API contract the SDK publishes. It carries no session and
// authenticates on a shared secret instead, so it must stay clear of the auth
// middleware -- which it does by living outside `/v1/auth`.
//
// Its body is parsed as text a layer earlier (config/application.ts) so the HMAC
// can be checked against the exact bytes ZeptoMail sent.
//
// It sits behind the GLOBAL per-IP limiter, which is what we want against a
// public URL scanners will find. ZeptoMail delivers from a small set of
// addresses, so in principle a mass bounce could be 429'd and lost -- but the
// limit is 300/min against a service that sends a handful of transactional mails
// a day, so reaching it would take a send this app cannot currently make. If
// volume ever changes that, this route needs its own bucket: a 429 here is a
// bounce we never learn about, because ZeptoMail's retry behaviour is
// undocumented.
// Where every link in a lifecycle email points.
//
// Registered by hand for the same reason the webhook below is: it answers a
// browser with a 302, not a client with JSON, so it is not part of the API
// contract the SDK publishes and there is nothing for the generator to describe.
//
// `noCache` is load-bearing rather than hygiene. The response is a redirect that
// varies by token and is followed by a shared mail scanner as often as by a
// reader, so a cache anywhere on the path could hand one recipient's destination
// to another.
//
// ON THE GLOBAL PER-IP LIMITER ONLY, and deliberately not on the unsubscribe
// one next to it. That bucket is five a minute, and the traffic this route
// actually sees is a mail scanner opening every link in a message -- nine inside
// twelve seconds, observed -- so the tight bucket would 429 most of a scan and,
// worse, spend the budget for whatever real reader shares that egress address. A
// 429 here is an error page in a win-back email, which is the one outcome the
// handler is written to never produce.
//
// There is little to abuse in any case: no write, no mail, no session, and a
// token nobody can forge, so the most a determined caller achieves is inflating
// their own click count. 300/min per IP is the right ceiling for that.
router.get(EMAIL_LINK_PATH, noCache, setRouteTemplate(EMAIL_LINK_PATH), handleEmailLinkClick);

router.post(WEBHOOK_ZEPTOMAIL_PATH, noCache, setRouteTemplate(WEBHOOK_ZEPTOMAIL_PATH), handleZeptomailWebhook);

export function mountRoutes(app: Application): Application {
  app.get('/up', noCache, healthCheck);

  // Tighter per-IP limit on the auth surface (scoped before the auth handlers).
  app.use('/v1/auth', authRateLimit);

  // Ties a sign-in code to the browser that asked for it, on the two paths that
  // issue and spend one. Ahead of `toNodeHandler` so a code from a browser that
  // never asked is refused before better-auth counts it as a failed attempt --
  // otherwise a stranger's guesses would burn the real reader's five tries.
  app.use(loginCodeBinding);

  // What actually bounds outbound sign-in mail: five an hour to one address, and
  // a ceiling across the whole application. Scoped to the send, not to
  // `/v1/auth` as a whole -- verifying a link or reading a session costs no mail
  // and must keep working while somebody is over their budget.
  //
  // Ahead of `toNodeHandler`, so a refused request never reaches better-auth and
  // never becomes a row. Both answer 429 with `Retry-After`, which is what the
  // modal counts down from.
  //
  // NOT MOUNTED LOCALLY, which is a routing decision rather than a `skip` inside
  // the limiters: local mail goes to letter-opener and the point of the local
  // flow is running it again and again, where a budget locks out the only person
  // it can reach. Keeping the limiters themselves free of an environment check
  // is also what lets the suite -- which runs as `local` -- exercise them.
  //
  // ADDRESS BEFORE CEILING, and the order is load-bearing: each limiter spends
  // its counter as the request passes through, so a ceiling mounted first is
  // spent by requests the address limiter is about to refuse. One client
  // hammering a single address -- or posting garbage bodies -- would be refused
  // after five and still drain the day's 2,000 in as many requests, taking
  // sign-in mail offline for everyone. Counting only what survives the
  // per-address gate makes exhausting the ceiling take ~400 distinct addresses
  // each under 5/hour, which is the mail-volume abuse it exists for.
  //
  // The trade: with the address limiter first, its in-memory key cardinality is
  // bounded by the upstream per-IP limiters rather than by the ceiling. Keys
  // expire with the hour window, so that is a bounded cost worth paying.
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
  ActivityRoutes,
  CollectionsRoutes,
  AdminRoutes,
  UserRoutes,
  FeedbackRoutes,
  EmailRoutes,
};
