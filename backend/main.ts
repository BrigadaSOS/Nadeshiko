// Must be called before all imports
require("dotenv").config();
const newrelic = require('newrelic');

import path from "path";
import { json } from "body-parser";
import { router } from "./routes/router";
import express, { Application } from "express";
import connection from "./database/db_posgres";
import { handleErrors } from "./middleware/errorHandler";

newrelic.instrumentLoadedModule('express', express)

const app: Application = express();

app.use(function (_req, res, next) {
  // Website you wish to allow to connect
  res.setHeader("Access-Control-Allow-Origin", "*");

  // Request methods you wish to allow
  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET, POST, OPTIONS, PUT, PATCH, DELETE"
  );

  // Request headers you wish to allow
  res.setHeader(
    "Access-Control-Allow-Headers",
    "X-Requested-With,content-type"
  );

  // Set to true if you need the website to include cookies in the requests sent
  // to the API (e.g. in case you use sessions)
  res.setHeader("Access-Control-Allow-Credentials", "true");

  // Pass to next layer of middleware
  next();
});

app.use(handleErrors);

if (process.env.ENVIRONMENT === "testing") {
  // Access media uploaded from outside localhost
  app.use(
    "/api/media/anime",
    express.static(path.join(__dirname, "/media/anime"), { fallthrough: false })
  );
  app.use(
    "/api/media/tmp",
    express.static(path.join(__dirname, "/media/tmp"), { fallthrough: false })
  );
} else if (process.env.ENVIRONMENT === "production") {
  // Access media uploaded from outside (DigitalOcean)
  let mediaDirectory: string = process.env.MEDIA_DIRECTORY!;
  app.use(
    "/api/media/anime",
    express.static(mediaDirectory, {
      fallthrough: false,
    })
  );
  app.use(
    "/api/media/tmp",
    express.static(mediaDirectory, {
      fallthrough: false,
    })
  );
}

app.use(json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);
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
