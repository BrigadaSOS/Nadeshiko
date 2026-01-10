// Must be called before all imports
import dotenv from 'dotenv';
dotenv.config({ quiet: true });

import './external/elasticsearch'; // Initialize client
import { initializeElasticsearchIndex } from './external/elasticsearch';
import { startSyncCron } from './services/syncCron';
import { safePath } from './utils/fs';
import { router } from './routes/router';
import express, { Application, ErrorRequestHandler } from 'express';
import connection from './database/db_posgres';
import { handleErrors } from './middleware/errorHandler';
import { requestIdMiddleware } from './middleware/requestId';
import { logger, httpLogger } from './utils/log';
import { NotFoundError } from './utils/apiErrors';
import { mediaLimiter, perEndpointLimiter } from './middleware/apiLimiterRate';
import { createImageMiddleware } from './middleware/imageMiddleware';
import { corsMiddleware } from './middleware/cors';
import { handleJsonParseErrors } from './middleware/requestParsing';
import { metricsMiddleware } from './middleware/metrics';
import { responseBodyLogger } from './middleware/responseBodyLogger';
import { rawBodySaver } from './middleware/rawBodySaver';

const PORT = process.env.PORT || 5000;
const app: Application = express();

// Trust X-Forwarded-* headers from reverse proxy (nginx, Cloudflare, etc.)
// Required for rate limiting and accurate client IP detection
app.set('trust proxy', 1);

// These handlers catch errors OUTSIDE of Express request handling.
// Express errors are handled by handleErrors middleware.
// These are for startup failures, event handlers, and other non-request errors.
process.on('uncaughtException', (error) => {
  logger.fatal(error, 'Uncaught Exception');
});

process.on('unhandledRejection', (reason, promise) => {
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

// Generate requestId for each request FIRST (so all logs and middleware have access to it)
app.use(requestIdMiddleware);

app.use(corsMiddleware);

// Capture response bodies BEFORE logging (must be before httpLogger)
app.use(responseBodyLogger);

// Parse incoming request bodies BEFORE httpLogger so req.rawBody is available for logging
// - json(): parses application/json payloads (up to 10MB)
// - urlencoded(): parses form submissions (up to 10MB)
// The verify callback in both captures the raw body to req.rawBody for logging
app.use(express.json({ limit: '10mb', verify: rawBodySaver as any }));
app.use(express.urlencoded({ extended: true, limit: '10mb', verify: rawBodySaver as any }));
app.use(handleJsonParseErrors);

// Log and measure ALL requests (must be after body parsers to include req.rawBody)
app.use(httpLogger);
app.use(metricsMiddleware);

type Environment = 'testing' | 'production';

const mediaConfigMap: Record<
  Environment,
  { mediaDir: string; cacheDir: string; tmpDir: string; useHighQualityKernel: boolean }
> = {
  testing: {
    mediaDir: safePath(__dirname, 'media'),
    cacheDir: 'tmp/cache',
    tmpDir: safePath(__dirname, 'media', 'tmp'),
    useHighQualityKernel: true,
  },
  production: {
    mediaDir: process.env.MEDIA_DIRECTORY!,
    cacheDir: 'media/tmp/cache',
    tmpDir: process.env.TMP_DIRECTORY!,
    useHighQualityKernel: false,
  },
};

const mediaConfig = mediaConfigMap[process.env.ENVIRONMENT as Environment];

if (mediaConfig) {
  app.use(
    '/api/media',
    mediaLimiter,
    createImageMiddleware(mediaConfig.mediaDir, mediaConfig.cacheDir, mediaConfig.useHighQualityKernel),
  );
  app.use('/api/media/tmp', mediaLimiter, express.static(mediaConfig.tmpDir, { fallthrough: false }));
}

// Actual route endpoints
app.use('/api', perEndpointLimiter, router);

// Catch-all 404 handler - must be after all routes, before error handler
app.use((req, res) => {
  const error = new NotFoundError(`Cannot ${req.method} ${req.originalUrl}`);
  error.instance = req.requestId;
  res.status(error.status).json(error.toJSON());
});

// Error handling middleware
app.use(handleErrors as ErrorRequestHandler);

// Starting the Server
app.listen(PORT, async () => {
  logger.info('===================================');
  logger.info(`Current environment: [${process.env.ENVIRONMENT}]`);
  logger.info('API is now available. Waiting for database...');

  try {
    await connection.authenticate();
    logger.info('Connection has been established successfully.');

    // Sync database models (creates missing tables, alters existing ones)
    await connection.sync({ alter: true });

    // Initialize Elasticsearch index if it doesn't exist
    await initializeElasticsearchIndex();

    logger.info('Database available. You can freely use this application');

    // Start the sync cron job after database is ready
    startSyncCron();
  } catch (error) {
    logger.error(error, 'Unable to connect to the database');
    process.exit(1);
  }
});
