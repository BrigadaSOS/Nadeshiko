import dotenv from 'dotenv';
dotenv.config({ quiet: true });

import { config } from '@config/config';
import { initTelemetry, shutdownTelemetry } from '@config/telemetry';
initTelemetry();

import '@app/services/elasticsearch'; // Initialize client
import '@app/subscribers'; // Import TypeORM subscribers
import { initPgBoss, stopPgBoss } from '@app/workers/pgBoss';
import { registerEsSyncWorkers } from '@app/workers/esSyncWorker';
import { registerEmailWorkers } from '@app/workers/emailWorker';
import { registerMorphemeWorkers } from '@app/workers/morphemeWorker';
import { seedCheckConfigs } from '@app/services/mediaReview/runner';
import { router } from '@app/routes/router';
import express, { Application, ErrorRequestHandler } from 'express';
import { initializeDatabase } from '@config/database';
import { handleErrors } from '@app/middleware/errorHandler';
import { requestIdMiddleware } from '@app/middleware/requestId';
import { logger, httpLogger } from '@config/log';
import { NotFoundError } from '@app/errors';
import { originSafetyLimiter } from '@app/middleware/apiLimiterRate';
import { handleJsonParseErrors } from '@app/middleware/requestParsing';
import { tracingMiddleware } from '@app/middleware/tracing';
import { responseBodyLogger } from '@app/middleware/responseBodyLogger';
import { rawBodySaver } from '@app/middleware/rawBodySaver';
import { auth } from '@config/auth';
import { toNodeHandler } from 'better-auth/node';
import { getAppEnvironment } from '@config/environment';

const PORT = config.PORT;
const app: Application = express();

// Trust X-Forwarded-* headers from reverse proxy (nginx, Cloudflare, etc.)
// Required for rate limiting and accurate client IP detection
app.set('trust proxy', 1);

// These handlers catch errors OUTSIDE of Express request handling
// (for startup failures, event handlers, and other non-request errors)
process.on('uncaughtException', (error) => {
  logger.fatal(error, 'Uncaught Exception');
});

process.on('unhandledRejection', (reason, _promise) => {
  logger.fatal(
    {
      reason: reason,
      reasonType: typeof reason,
      reasonString: String(reason),
      stack: reason instanceof Error ? reason.stack : new Error('Unhandled Rejection').stack,
    },
    'Unhandled Rejection',
  );
});

// Graceful shutdown
async function shutdown(signal: string) {
  logger.info(`Received ${signal}, shutting down gracefully...`);

  try {
    await shutdownTelemetry();
    await stopPgBoss();
    logger.info('PgBoss stopped');
    process.exit(0);
  } catch (error) {
    logger.error(error, 'Error during shutdown');
    process.exit(1);
  }
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

app.use(requestIdMiddleware);

// Capture response bodies BEFORE logging (must be before httpLogger)
app.use(responseBodyLogger);

// Parse incoming request bodies BEFORE httpLogger so req.rawBody is available for logging
// The verify callback in both captures the raw body to req.rawBody for logging
app.use(express.json({ limit: '10mb', verify: rawBodySaver as any }));
app.use(express.urlencoded({ extended: true, limit: '10mb', verify: rawBodySaver as any }));
app.use(handleJsonParseErrors);

app.use(httpLogger);
app.use(tracingMiddleware);
// Route endpoints
app.get('/up', (_req, res) => res.status(200).send('OK'));
const noCache = (_req: any, res: any, next: any) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('CDN-Cache-Control', 'no-store');
  next();
};
app.all('/v1/auth', noCache, toNodeHandler(auth));
app.all('/v1/auth/*splat', noCache, toNodeHandler(auth));
app.use('/', originSafetyLimiter, router);

// Catch-all 404 handler
app.use((req, res) => {
  const error = new NotFoundError(`Cannot ${req.method} ${req.originalUrl}`);
  error.instance = req.requestId;
  res.status(error.status).json(error.toJSON());
});

// Error handling middleware
app.use(handleErrors as ErrorRequestHandler);

app.listen(PORT, async () => {
  const environment = getAppEnvironment();

  logger.info('===================================');
  logger.info(`Current environment: [${environment}]`);
  logger.info('API is now available. Waiting for database...');

  try {
    // Initialize database connection
    await initializeDatabase();

    // Initialize pg-boss and register workers
    const boss = await initPgBoss();
    await registerEsSyncWorkers(boss);
    await registerEmailWorkers(boss);
    await registerMorphemeWorkers(boss);

    // Seed review check configs (idempotent)
    await seedCheckConfigs();

    logger.info('Database available. You can freely use this application');
  } catch (error) {
    logger.error(error, 'Unable to connect to the database');
    process.exit(1);
  }
});
