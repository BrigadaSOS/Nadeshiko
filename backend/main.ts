// Must be called before all imports
import dotenv from 'dotenv';
dotenv.config({ quiet: true });

import './external/elasticsearch'; // Initialize client
import { safePath } from './utils/fs';
import { router } from './routes/router';
import express, { Application, ErrorRequestHandler } from 'express';
import connection from './database/db_posgres';
import { handleErrors } from './middleware/errorHandler';
import { logger, httpLogger } from './utils/log';
import { mediaLimiter, perEndpointLimiter } from './middleware/apiLimiterRate';
import { createImageMiddleware } from './middleware/imageMiddleware';
import { corsMiddleware } from './middleware/cors';
import { handleJsonParseErrors } from './middleware/requestParsing';
import { metricsMiddleware } from './middleware/metrics';

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

process.on('unhandledRejection', (error) => {
  logger.fatal(error, 'Unhandled Rejection');
});

app.use(corsMiddleware);

// Log and measure ALL requests (must be before routes)
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

// Parse incoming request bodies
// - json(): parses application/json payloads (up to 10MB)
// - urlencoded(): parses form submissions (up to 10MB)
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(handleJsonParseErrors);

// Actual route endpoints
app.use('/api', perEndpointLimiter, router);

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
    logger.info('Database available. You can freely use this application');
  } catch (error) {
    logger.error(error, 'Unable to connect to the database');
    process.exit(1);
  }
});
