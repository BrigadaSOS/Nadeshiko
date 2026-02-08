import dotenv from 'dotenv';
dotenv.config({ quiet: true });

import '@lib/external/elasticsearch'; // Initialize client
import '@app/subscribers'; // Import TypeORM subscribers
import { initPgBoss, stopPgBoss } from '@lib/queue/pgBoss';
import { registerEsSyncWorkers } from '@lib/queue/workers/esSyncWorker';
import { registerEmailWorkers } from '@lib/queue/workers/emailWorker';
import { router } from '@app/routes/router';
import express, { Application, ErrorRequestHandler } from 'express';
import { initializeDatabase } from '@config/database';
import { handleErrors } from '@app/middleware/errorHandler';
import { requestIdMiddleware } from '@app/middleware/requestId';
import { logger, httpLogger } from '@lib/utils/log';
import { NotFoundError } from '@lib/utils/apiErrors';
import { originSafetyLimiter } from '@app/middleware/apiLimiterRate';
import { corsMiddleware } from '@app/middleware/cors';
import { handleJsonParseErrors } from '@app/middleware/requestParsing';
import { metricsMiddleware } from '@app/middleware/metrics';
import { responseBodyLogger } from '@app/middleware/responseBodyLogger';
import { rawBodySaver } from '@app/middleware/rawBodySaver';
import { auth } from '@lib/auth';
import { toNodeHandler } from 'better-auth/node';
import { getAppEnvironment } from '@lib/environment';

const PORT = process.env.PORT || 5000;
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
app.use(corsMiddleware);

// Capture response bodies BEFORE logging (must be before httpLogger)
app.use(responseBodyLogger);

// Parse incoming request bodies BEFORE httpLogger so req.rawBody is available for logging
// The verify callback in both captures the raw body to req.rawBody for logging
app.use(express.json({ limit: '10mb', verify: rawBodySaver as any }));
app.use(express.urlencoded({ extended: true, limit: '10mb', verify: rawBodySaver as any }));
app.use(handleJsonParseErrors);

app.use(httpLogger);
app.use(metricsMiddleware);

// Route endpoints
app.get('/up', (_req, res) => res.status(200).send('OK'));
app.all('/api/auth', toNodeHandler(auth));
app.all('/api/auth/*splat', toNodeHandler(auth));
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

    logger.info('Database available. You can freely use this application');
  } catch (error) {
    logger.error(error, 'Unable to connect to the database');
    process.exit(1);
  }
});
