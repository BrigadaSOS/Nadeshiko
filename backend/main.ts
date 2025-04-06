// Must be called before all imports
require('dotenv').config();

import './external/elasticsearch'; // Initialize client
import path from 'path';
import { router } from './routes/router';
import express, { Application } from 'express';
import connection from './database/db_posgres';
import { handleErrors } from './middleware/errorHandler';
import winston, { log } from 'winston';
import expressWinston from 'express-winston';
import { expressWinstonErrorLogger, expressWinstonLogger } from './utils/log';

const bodyParser = require('body-parser');
const promBundle = require('express-prom-bundle');
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

// @ts-ignore
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

const sharp = require('sharp');
const fs = require('fs');

if (process.env.ENVIRONMENT === 'testing') {
  // Access media uploaded from outside localhost
  app.use('/api/media', (req, res, next) => {
    const width = req.query.width ? Number(req.query.width) : null;
    const height = req.query.height ? Number(req.query.height) : null;
    const imagePath = path.join(__dirname, '/media', req.path);

    // If no resizing parameters are provided, serve the original image
    if (!width && !height) {
      return express.static(path.join(__dirname, '/media'))(req, res, next);
    }

    const cacheDir = path.join(__dirname, 'media/tmp/cache', path.dirname(req.path));
    const cachePath = path.join(cacheDir, `${path.basename(req.path.replace('.webp', ''))}-${width}_${height}.webp`);

    if (!fs.existsSync(cacheDir)) {
      fs.mkdirSync(cacheDir, { recursive: true });
    }

    if (fs.existsSync(cachePath)) {
      return res.sendFile(cachePath);
    }

    sharp(imagePath)
      .resize(width, height, {
        kernel: sharp.kernel.lanczos3,
      })
      .toFile(cachePath)
      .then(() => {
        res.sendFile(cachePath);
      })
      .catch((err: any) => {
        console.error(err);
        res.status(500).end();
      });
  });

  app.use('/api/media/tmp', express.static(path.join(__dirname, '/media/tmp'), { fallthrough: false }));
} else if (process.env.ENVIRONMENT === 'production') {
  // Access media uploaded from outside (DigitalOcean)
  const mediaDirectory: string = process.env.MEDIA_DIRECTORY!;
  const tmpDirectory: string = process.env.TMP_DIRECTORY!;

  app.use('/api/media', (req, res, next) => {
    const width = req.query.width ? Number(req.query.width) : null;
    const height = req.query.height ? Number(req.query.height) : null;
    const imagePath = path.join(mediaDirectory, req.path);

    if (!width && !height) {
      return express.static(mediaDirectory, { fallthrough: false })(req, res, next);
    }

    const cacheDir = path.join(mediaDirectory, 'media/tmp/cache', path.dirname(req.path));
    const cachePath = path.join(cacheDir, `${path.basename(req.path.replace('.webp', ''))}-${width}_${height}.webp`);

    if (!fs.existsSync(cacheDir)) {
      fs.mkdirSync(cacheDir, { recursive: true });
    }

    if (fs.existsSync(cachePath)) {
      return res.sendFile(cachePath);
    }

    sharp(imagePath)
      .resize(width, height)
      .toFile(cachePath)
      .then(() => {
        res.sendFile(cachePath);
      })
      .catch((err: any) => {
        console.error(err);
        res.status(500).end();
      });
  });

  app.use(
    '/api/media/tmp',
    express.static(tmpDirectory, {
      fallthrough: false,
    }),
  );
}

app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '10mb' }));

// Must go before router
app.use(expressWinstonLogger);
app.use(metricsMiddleware);
app.use('/api', router);

// Must go after router
app.use(expressWinstonErrorLogger);

app.use(
  expressWinston.errorLogger({
    transports: [new winston.transports.Console()],
    format: winston.format.combine(winston.format.timestamp(), winston.format.errors(), winston.format.prettyPrint()),
  }),
);

// @ts-ignore
app.use(handleErrors);

if (!parseInt(process.env.PORT as string)) {
  process.exit(1);
}

app.use(function (err: any, _req: any, _res: any, next: (arg0: any) => void) {
  console.log(err);
  next(err);
});

// Ultra error handler
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception: ', error);
});

process.on('unhandledRejection', (error) => {
  console.error('Unhandled Rejection: ', error);
});

// Starting the Server
app.listen(process.env.PORT || 5000, async () => {
  console.log('===================================');
  console.log(`Current environment: [${process.env.ENVIRONMENT}]`);
  console.log(`API is now available. Waiting for database...`);
  try {
    await connection
      .authenticate()
      .then(() => {
        console.log('Connection has been established successfully.');
      })
      .catch((error) => {
        console.error('Unable to connect to the database: ', error);
      });
    console.log(`Database available. You can freely use this application`);
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
});
