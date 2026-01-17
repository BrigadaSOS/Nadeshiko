// Must be called before all imports
import 'dotenv/config';

import './external/elasticsearch'; // Initialize client
import path from 'path';
import { router } from './routes/router';
import express, { Application } from 'express';
import connection from './database/db_posgres';
import { handleErrors } from './middleware/errorHandler';
import { logger, httpLogger } from './utils/log';
import { perEndpointLimiter } from './middleware/apiLimiterRate';

import bodyParser from 'body-parser';
import promBundle from 'express-prom-bundle';
import sharp from 'sharp';
import fs from 'fs';
const metricsMiddleware = promBundle({
  includeMethod: true,
  includePath: true,
  includeStatusCode: true,
  includeUp: true,
  promClient: {
    collectDefaultMetrics: {},
  },
});

const app: Application = express();
app.set('trust proxy', 1);
const allowedOrigins = process.env.ALLOWED_WEBSITE_URLS ? process.env.ALLOWED_WEBSITE_URLS.split(',') : [];

// @ts-expect-error -- express middleware signature
app.use(function (req, res, next) {
  // Obtiene el origen de la solicitud
  const origin: string | undefined = req.headers.origin;

  // Si el origen de la solicitud está en la lista de origines permitidos, establece el encabezado Access-Control-Allow-Origin
  if (allowedOrigins.includes(origin as string)) {
    res.setHeader('Access-Control-Allow-Origin', origin as string);
  }

  // Request methods you wish to allow
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, PATCH, DELETE');

  // Request headers you wish to allow
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-Requested-With,content-type,traceparent,tracestate,x-api-key,Authorization',
  );

  // Set to true if you need the website to include cookies in the requests sent
  // to the API (e.g. in case you use sessions)
  res.setHeader('Access-Control-Allow-Credentials', 'true');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  // Pass to next layer of middleware
  next();
});

const createImageMiddleware = (baseMediaDir: string, cacheDirSuffix: string, useHighQualityKernel: boolean = false) => {
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const width = req.query.width ? Number(req.query.width) : null;
    const height = req.query.height ? Number(req.query.height) : null;
    const imagePath = path.join(baseMediaDir, req.path);

    if (!width && !height) {
      return express.static(baseMediaDir, {
        maxAge: '30d',
        etag: true,
        lastModified: true,
        fallthrough: false,
      })(req, res, next);
    }

    const cacheDir = path.join(baseMediaDir, cacheDirSuffix, path.dirname(req.path));
    const cachePath = path.join(cacheDir, `${path.basename(req.path.replace('.webp', ''))}-${width}_${height}.webp`);

    if (!fs.existsSync(cacheDir)) {
      fs.mkdirSync(cacheDir, { recursive: true });
    }

    const setCacheHeaders = (filePath: string) => {
      const stats = fs.statSync(filePath);
      const etag = `"${stats.mtime.getTime()}-${stats.size}"`;

      res.setHeader('Cache-Control', 'public, max-age=2592000, must-revalidate');
      res.setHeader('ETag', etag);
      res.setHeader('Last-Modified', stats.mtime.toUTCString());

      if (req.headers['if-none-match'] === etag) {
        res.status(304).end();
        return true;
      }
      return false;
    };

    if (fs.existsSync(cachePath)) {
      if (setCacheHeaders(cachePath)) return;
      return res.sendFile(cachePath);
    }

    const resizeOptions = useHighQualityKernel ? { kernel: sharp.kernel.lanczos3 } : {};

    sharp(imagePath)
      .resize(width, height, resizeOptions)
      .toFile(cachePath)
      .then(() => {
        if (setCacheHeaders(cachePath)) return;
        res.sendFile(cachePath);
      })
      .catch((err: any) => {
        logger.error({ err, imagePath, cachePath }, 'Sharp image processing failed');
        res.status(500).end();
      });
  };
};

if (process.env.ENVIRONMENT === 'testing') {
  const mediaDir = path.join(__dirname, '/media');
  app.use('/api/media', createImageMiddleware(mediaDir, 'tmp/cache', true));
  app.use('/api/media/tmp', express.static(path.join(__dirname, '/media/tmp'), { fallthrough: false }));
} else if (process.env.ENVIRONMENT === 'production') {
  const mediaDirectory: string = process.env.MEDIA_DIRECTORY!;
  const tmpDirectory: string = process.env.TMP_DIRECTORY!;

  app.use('/api/media', createImageMiddleware(mediaDirectory, 'media/tmp/cache', false));
  app.use('/api/media/tmp', express.static(tmpDirectory, { fallthrough: false }));
}

app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '10mb' }));

// Must go before router
app.use(httpLogger);
app.use(metricsMiddleware);
app.use('/api', perEndpointLimiter);
app.use('/api', router);

// @ts-expect-error -- error handler type
app.use(handleErrors);

if (!parseInt(process.env.PORT as string)) {
  process.exit(1);
}

app.use(function (err: any, _req: any, _res: any, next: (arg0: any) => void) {
  logger.error({ err }, 'Unhandled middleware error');
  next(err);
});

// Ultra error handler
process.on('uncaughtException', (error) => {
  logger.fatal(error, 'Uncaught Exception');
});

process.on('unhandledRejection', (error) => {
  logger.fatal(error, 'Unhandled Rejection');
});

// Starting the Server
app.listen(process.env.PORT || 5000, async () => {
  logger.info('===================================');
  logger.info(`Current environment: [${process.env.ENVIRONMENT}]`);
  logger.info('API is now available. Waiting for database...');
  try {
    await connection
      .authenticate()
      .then(() => {
        logger.info('Connection has been established successfully.');
      })
      .catch((error) => {
        logger.error(error, 'Unable to connect to the database');
      });
    logger.info('Database available. You can freely use this application');
  } catch (error) {
    logger.error(error, 'Failed to initialize database');
    process.exit(1);
  }
});
