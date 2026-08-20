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

/**
 * A bounce notification is a few kilobytes. The generous global limit exists for
 * segment payloads and has no business applying to a public, unauthenticated
 * endpoint that anyone on the internet can post to.
 */
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
  // Trust X-Forwarded-* headers from one reverse proxy hop (kamal-proxy) for
  // per-IP rate-limit keying and client-IP logging. Note this is best-effort
  // attribution, not a trust boundary: both direct and frontend-proxied traffic
  // reach us through kamal-proxy, so `req.ip` cannot be trusted to decide who is
  // internal. The rate limiter distinguishes proxied traffic via an unforgeable
  // shared secret (INTERNAL_PROXY_SECRET) instead — see rateLimit.ts.
  app.set('trust proxy', 1);

  app.use(
    helmet({
      // The backend is a JSON API -- no HTML pages to frame or inject into.
      // These defaults are fine; CSP is not needed for pure API responses.
      contentSecurityPolicy: false,
    }),
  );

  app.use(requestIdMiddleware);

  // Label the traffic before anything can reject it: a 429 or a parse error is
  // worth splitting by reader/bot/monitor too, and everything downstream (the
  // access log, the error counters) reads the answer off the request.
  app.use(trafficClassification);

  // BEFORE the rate limiter, deliberately. A preflight carries no data and the
  // client did not choose to send it, but it is a whole request against the
  // per-IP bucket -- and that bucket is shared by everyone behind one address,
  // which for the mobile-carrier CGNAT much of this API's third-party traffic
  // arrives through can be a lot of unrelated people. Charging them for the
  // browser's own protocol overhead would make the limit fire on load that
  // nobody generated. It costs the preflight its access-log line (httpLogger is
  // further down), which is an acceptable trade for a request whose entire
  // content is in the response headers.
  app.use(corsPolicy);

  // Rate-limit unauthenticated traffic BEFORE parsing bodies so abusive bots
  // are rejected cheaply without burning CPU on JSON parse.
  if (rateLimitMiddleware) {
    app.use(rateLimitMiddleware);
  }

  // Capture response bodies BEFORE logging (must be before httpLogger)
  app.use(responseBodyLogger);

  // The ZeptoMail webhook, before the JSON parser can reach it.
  //
  // Its body has to survive as the EXACT bytes that were sent, because the HMAC
  // is computed over them, and it arrives in two different shapes: the docs
  // describe form-encoded `data=<urlencoded JSON>` and the console posts plain
  // JSON. `express.json` would parse one and ignore the other, leaving the
  // signature uncheckable in both cases. `type: '*/*'` takes whichever turns up
  // as text; body-parser marks the body handled, so the JSON parser below is a
  // no-op for this path rather than a second read of a consumed stream.
  //
  // NO `verify: rawBodySaver` here on purpose. It would put the whole payload --
  // a bouncing person's address and the receiving server's message about them --
  // into the HTTP access log. The verified event is stored in `EmailEvent` where
  // it is the subject of the record and access is controlled.
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
    // The attributes have to be identical on both sides of the pair or the
    // gauge never returns to zero, so they are computed once here rather than
    // read off the request again on finish.
    const attributes = { 'http.request.method': req.method, ...trafficAttributesFor(req) };
    activeRequests.add(1, attributes);
    res.on('finish', () => activeRequests.add(-1, attributes));
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
