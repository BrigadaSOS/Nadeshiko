// Must be called before all imports
require("dotenv").config();
const newrelic = require("newrelic");

import "./external/elasticsearch"; // Initialize client
import path from "path";
import { json } from "body-parser";
import { router } from "./routes/router";
import express, { Application } from "express";
import connection from "./database/db_posgres";
import { handleErrors } from "./middleware/errorHandler";
import winston, {log} from 'winston';
import expressWinston from 'express-winston';
import {expressWinstonErrorLogger, expressWinstonLogger} from "./utils/log";

newrelic.instrumentLoadedModule("express", express);

const app: Application = express();

const allowedOrigins = ["http://localhost:5173", "https://db.brigadasos.xyz"];
var cors = require('cors');
const corsOptions = {
  origin: function (origin: any, callback:any) {
    if (allowedOrigins.includes(origin) || !origin) {
      callback(null, true);
    } else {
      callback(new Error('Origen no permitido por CORS'));
    }
  },
  credentials: true,
  exposedHeaders: ["set-cookie"]
};

app.use(cors(corsOptions));
app.set('trust proxy', true);

const sharp = require("sharp");
const fs = require("fs");

if (process.env.ENVIRONMENT === "testing") {
  // Access media uploaded from outside localhost
  app.use("/api/media/anime", (req, res, next) => {
    const width = req.query.width ? Number(req.query.width) : null;
    const height = req.query.height ? Number(req.query.height) : null;
    const imagePath = path.join(__dirname, "/media/anime", req.path);

    // If no resizing parameters are provided, serve the original image
    if (!width && !height) {
      return express.static(path.join(__dirname, "/media/anime"))(
        req,
        res,
        next
      );
    }

    const cacheDir = path.join(
      __dirname,
      "media/tmp/cache/anime",
      path.dirname(req.path)
    );
    const cachePath = path.join(
      cacheDir,
      `${path.basename(req.path.replace(".webp", ""))}-${width}_${height}.webp`
    );

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

  app.use(
    "/api/media/tmp",
    express.static(path.join(__dirname, "/media/tmp"), { fallthrough: false })
  );
} else if (process.env.ENVIRONMENT === "production") {
  // Access media uploaded from outside (DigitalOcean)
  const mediaDirectory: string = process.env.MEDIA_DIRECTORY!;
  const tmpDirectory: string = process.env.TMP_DIRECTORY!;

  app.use("/api/media/anime", (req, res, next) => {
    const width = req.query.width ? Number(req.query.width) : null;
    const height = req.query.height ? Number(req.query.height) : null;
    const imagePath = path.join(mediaDirectory, req.path);

    if (!width && !height) {
      return express.static(mediaDirectory, { fallthrough: false })(
        req,
        res,
        next
      );
    }

    const cacheDir = path.join(
      mediaDirectory,
      "media/tmp/cache/anime",
      path.dirname(req.path)
    );
    const cachePath = path.join(
      cacheDir,
      `${path.basename(req.path.replace(".webp", ""))}-${width}_${height}.webp`
    );

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
    "/api/media/tmp",
    express.static(tmpDirectory, {
      fallthrough: false,
    })
  );
}

app.use(json());
app.use(express.urlencoded({ extended: true }));

// Must go before router
app.use(expressWinstonLogger);

app.use("/api", router);

// Must go after router
app.use(expressWinstonErrorLogger);

app.use(expressWinston.errorLogger({
  transports: [
      new winston.transports.Console()
  ],
  format: winston.format.combine(
      winston.format.timestamp(),
      winston.format.errors(),
      winston.format.prettyPrint()
  )
}));

// @ts-ignore
app.use(handleErrors);

if (!parseInt(process.env.PORT as string)) {
  process.exit(1);
}

app.use(function (err: any, _req: any, _res: any, next: (arg0: any) => void) {
  console.log(err);
  next(err);
});

// Starting the Server
app.listen(process.env.PORT || 5000, async () => {
  console.log("===================================");
  console.log(`Current environment: [${process.env.ENVIRONMENT}]`);
  console.log(`API is now available. Waiting for database...`);
  try {
    await connection
      .authenticate()
      .then(() => {
        console.log("Connection has been established successfully.");
      })
      .catch((error) => {
        console.error("Unable to connect to the database: ", error);
      });
    console.log(`Database available. You can freely use this application`);
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
});
