import express, { type Application, type ErrorRequestHandler, type RequestHandler } from 'express';
import helmet from 'helmet';
import { corsPolicy } from '@app/middleware/cors';
import { handleErrors } from '@app/middleware/errorHandler';
import { NotFoundError } from '@app/errors';
import { handleJsonParseErrors } from '@app/middleware/requestParsing';
import { responseBodyLogger } from '@app/middleware/responseBodyLogger';
import { rawBodySaver } from '@app/middleware/rawBodySaver';
import { httpLogger } from '@config/log';
import { requestIdMiddleware } from '@app/middleware/requestId';
import { globalRateLimit } from '@app/middleware/rateLimit';
import { trafficClassification, trafficAttributesFor } from '@app/middleware/trafficClassification';
import { mountRoutes as defaultMountRoutes } from '@config/routes';
import { getMeter } from '@config/telemetry';
import { WEBHOOK_ZEPTOMAIL_PATH } from '@app/controllers/webhooks/paths';

const JSON_BODY_LIMIT = '10mb';

/** Keep the public unauthenticated bounce endpoint below the generous segment-body limit; a few-kilobyte
 * notification does not justify accepting arbitrarily large posts. */
const WEBHOOK_BODY_LIMIT = '256kb';

type RouteMounter = (app: Application) => void;

interface BuildApplicationOptions {
  beforeRoutes?: RequestHandler[];
  mountRoutes?: RouteMounter;
  rateLimit?: RequestHandler | false;
}

function mountDefaultRoutes(app: Application) {
  defaultMountRoutes(app);
}

function mountCustomRoutes(app: Application, mountRoutes?: RouteMounter) {
  if (mountRoutes) {
    mountRoutes(app);
    return;
  }
  mountDefaultRoutes(app);
}

function mountPreRouteMiddleware(app: Application, middleware: RequestHandler[] = []) {
  for (const handler of middleware) {
    app.use(handler);
  }
}

function configureMiddleware(
  app: Application,
  rateLimitMiddleware: RequestHandler | false = globalRateLimit,
): Application {
  // Trust one Kamal proxy hop only for best-effort IP logging/rate-limit keys, never authorization; internal traffic is
  // identified by `INTERNAL_PROXY_SECRET`.
  app.set('trust proxy', 1);

  app.use(
    helmet({
      // The backend is a JSON API -- no HTML pages to frame or inject into.
      // These defaults are fine; CSP is not needed for pure API responses.
      contentSecurityPolicy: false,
    }),
  );

  app.use(requestIdMiddleware);

  // Classify traffic before rejection so logs and metrics retain the reader/bot/monitor dimension.
  app.use(trafficClassification);

  // Run CORS preflight before rate limiting: charging shared CGNAT buckets for browser protocol overhead would
  // rate-limit unrelated users; the trade is no access-log line for the header-only response.
  app.use(corsPolicy);

  // Rate-limit unauthenticated traffic BEFORE parsing bodies so abusive bots
  // are rejected cheaply without burning CPU on JSON parse.
  if (rateLimitMiddleware) {
    app.use(rateLimitMiddleware);
  }

  // Capture response bodies BEFORE logging (must be before httpLogger)
  app.use(responseBodyLogger);

  // Read the ZeptoMail webhook as exact text before JSON parsing because signatures cover either form-encoded or JSON
  // bytes. Do not enable a raw-body verifier here: it would log sensitive payloads; verified events belong in
  // `EmailEvent`.
  app.use(WEBHOOK_ZEPTOMAIL_PATH, express.text({ type: '*/*', limit: WEBHOOK_BODY_LIMIT }));

  // Parse incoming request bodies BEFORE httpLogger so req.rawBody is available for logging
  app.use(express.json({ limit: JSON_BODY_LIMIT, verify: rawBodySaver as any }));
  app.use(handleJsonParseErrors as ErrorRequestHandler);

  app.use(httpLogger);

  const activeRequests = getMeter().createUpDownCounter('http.server.active_requests', {
    description: 'Number of active HTTP server requests',
    unit: '{request}',
  });
  app.use((req, res, next) => {
    // Compute paired gauge attributes once so both start/finish sides remain identical.
    const attributes = { 'http.request.method': req.method, ...trafficAttributesFor(req) };
    activeRequests.add(1, attributes);
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      activeRequests.add(-1, attributes);
    };
    res.once('finish', release);
    res.once('close', release);
    next();
  });

  return app;
}

function configureRoutes(app: Application, mountRoutes?: RouteMounter): Application {
  mountCustomRoutes(app, mountRoutes);
  return app;
}

function configureErrorHandling(app: Application): Application {
  // Catch-all 404 handler
  app.use((req, res) => {
    const error = new NotFoundError(`Cannot ${req.method} ${req.originalUrl}`);
    error.instance = req.requestId;
    res.status(error.status).json(error.toJSON());
  });

  app.use(handleErrors as ErrorRequestHandler);

  return app;
}

export function buildApplication(options: BuildApplicationOptions = {}): Application {
  const app: Application = express();
  configureMiddleware(app, options.rateLimit);
  mountPreRouteMiddleware(app, options.beforeRoutes);
  configureRoutes(app, options.mountRoutes);
  configureErrorHandling(app);
  return app;
}
