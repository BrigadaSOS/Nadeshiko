import express, { type Application, type ErrorRequestHandler, type RequestHandler } from 'express';
import helmet from 'helmet';
import { handleErrors } from '@app/middleware/errorHandler';
import { NotFoundError } from '@app/errors';
import { handleJsonParseErrors } from '@app/middleware/requestParsing';
import { responseBodyLogger } from '@app/middleware/responseBodyLogger';
import { rawBodySaver } from '@app/middleware/rawBodySaver';
import { httpLogger } from '@config/log';
import { requestIdMiddleware } from '@app/middleware/requestId';
import { mountRoutes as defaultMountRoutes } from '@config/routes';
import { getMeter } from '@config/telemetry';

const JSON_BODY_LIMIT = '10mb';

type RouteMounter = (app: Application) => void;

export interface BuildApplicationOptions {
  beforeRoutes?: RequestHandler[];
  mountRoutes?: RouteMounter;
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

export function configureMiddleware(app: Application): Application {
  // Trust X-Forwarded-* headers from reverse proxy (nginx, Cloudflare, etc.)
  // Required for rate limiting and accurate client IP detection
  app.set('trust proxy', 1);

  app.use(
    helmet({
      // The backend is a JSON API -- no HTML pages to frame or inject into.
      // These defaults are fine; CSP is not needed for pure API responses.
      contentSecurityPolicy: false,
    }),
  );

  app.use(requestIdMiddleware);

  // Capture response bodies BEFORE logging (must be before httpLogger)
  app.use(responseBodyLogger);

  // Parse incoming request bodies BEFORE httpLogger so req.rawBody is available for logging
  app.use(express.json({ limit: JSON_BODY_LIMIT, verify: rawBodySaver as any }));
  app.use(handleJsonParseErrors as ErrorRequestHandler);

  app.use(httpLogger);

  const activeRequests = getMeter().createUpDownCounter('http.server.active_requests', {
    description: 'Number of active HTTP server requests',
    unit: '{request}',
  });
  app.use((req, res, next) => {
    activeRequests.add(1, { 'http.request.method': req.method });
    res.on('finish', () => activeRequests.add(-1, { 'http.request.method': req.method }));
    next();
  });

  return app;
}

export function configureRoutes(app: Application, mountRoutes?: RouteMounter): Application {
  mountCustomRoutes(app, mountRoutes);
  return app;
}

export function configureErrorHandling(app: Application): Application {
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
  configureMiddleware(app);
  mountPreRouteMiddleware(app, options.beforeRoutes);
  configureRoutes(app, options.mountRoutes);
  configureErrorHandling(app);
  return app;
}
