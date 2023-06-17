import express, { Application } from "express";
const fs = require("fs");
import { handleErrors } from "./middleware/errorHandler";
import connection from "./database/db_posgres";
import { router } from "./routes/router";
import path from "path";
import { json } from "body-parser";
import * as dotenv from "dotenv";
const csv = require("csv-parser");
import { Op } from "sequelize";

import { Media } from "./models/media/media";
import { Category } from "./models/media/category";
import { Season } from "./models/media/season";
import { Episode } from "./models/media/episode";
import { Segment } from "./models/media/segment";

dotenv.config();

const app: Application = express();

app.use(function (req, res, next) {
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
  res.setHeader("Access-Control-Allow-Credentials", true);

  // Pass to next layer of middleware
  next();
});

if (process.env.ENVIROMENT === "testing") {
  // Access media uploaded from outside localhost
  app.use(
    "/api/media/anime",
    express.static(path.join(__dirname, "/media/anime"), { fallthrough: false })
  );
  app.use(
    "/api/media/tmp",
    express.static(path.join(__dirname, "/media/tmp"), { fallthrough: false })
  );
} else if (process.env.ENVIROMENT === "production") {
  // Access media uploaded from outside (DigitalOcean)
  app.use(
    "/api/media/anime",
    express.static(path.join(__dirname, "../media/anime"), {
      fallthrough: false,
    })
  );
  app.use(
    "/api/media/tmp",
    express.static(path.join(__dirname, "../media/tmp"), {
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

app.get("/*", (_req, res) => {
  res.status(200).json({ message: "Hello world :)" });
});

app.use(function (err: any, _req: any, _res: any, next: (arg0: any) => void) {
  console.log(err);
  next(err);
});

// Starting the Server
app.listen(process.env.PORT || 5000, async () => {
  console.log("==========================");
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

    await reSyncDatabase();

    console.log(`Database available. You can freely use this application`);
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
});

async function reSyncDatabase() {
  // Force drop and resync
  await connection.sync({ force: true }).then(async () => {
    const db = connection.models;
    await addBasicData(db);
    let mediaDirectory: string = process.env.MEDIA_DIRECTORY!;
    await readAnimeDirectories(mediaDirectory);
    //await readSpecificAnimeDirectory(mediaDirectory, "");
  });
}

async function addBasicData(db: any) {
  await db.Category.create({
    name: "Anime",
  });

  await db.Category.create({
    name: "Book",
  });
}

async function readSpecificAnimeDirectory(baseDir: string, animeName: string) {

}

async function readAnimeDirectories(baseDir: string) {
  const animeDirectories = fs.readdirSync(baseDir);

  for (const animeItem of animeDirectories) {
    const animeDirPath = path.join(baseDir, animeItem);

    let media = await Media.create(
      {
        english_name: animeItem,
        id_category: 1,
      },
      { include: Category }
    );

    await media.save();

    if (fs.statSync(animeDirPath).isDirectory()) {
      const temporadaDirectories = fs.readdirSync(animeDirPath);

      for (const tempItem of temporadaDirectories) {
        const tempDirPath = path.join(animeDirPath, tempItem);

        let media = await Media.findOne({
          where: { english_name: animeItem },
          include: [Season, Category],
        });

        const number_season = tempItem.replace("S", "");

        if (media) {
          let season = await Season.create({
            mediaId: media.id,
            number: number_season,
          });

          await season.save();
        }

        if (fs.statSync(tempDirPath).isDirectory()) {
          const episodeDirectories = fs.readdirSync(tempDirPath);

          for (const episodeItem of episodeDirectories) {
            const episodeDirPath = path.join(tempDirPath, episodeItem);

            let season = await Season.findOne({
              where: {
                mediaId: media?.id,
                number: number_season,
              },
              include: [Episode],
            });

            let number_episode = episodeItem;

            let episode: Episode | null = null;

            if (season) {
              episode = await Episode.create({
                seasonId: season?.id,
                number: number_episode,
              });

              await episode.save();
            }

            const episodeItems = fs.readdirSync(episodeDirPath);
            const dataCsvPath = path.join(episodeDirPath, "data.csv");
            const dataCsvExists = fs.existsSync(dataCsvPath);

            if (dataCsvExists) {
              console.log("Anime data has been found: ", dataCsvPath);
              const rows = [];

              const stream = fs.createReadStream(dataCsvPath)
                .pipe(csv({ separator: ";" }));

              for await (const row of stream) {
                rows.push(row);
              }

              // Realizar inserciones en lotes
              const batchSize = 100;
              const batchCount = Math.ceil(rows.length / batchSize);

              for (let i = 0; i < batchCount; i++) {
                const start = i * batchSize;
                const end = start + batchSize;
                const batchRows = rows.slice(start, end);

                await insertSegments(batchRows, episode);
              }
            }
          }
        }
      }
    }
  }
}

async function insertSegments(rows: any[], episode: Episode | null) {
  await Promise.all(
    rows.map(async (row: any) => {
      if (episode) {
        let segment = await Segment.create({
          start_time: row.START_TIME,
          end_time: row.END_TIME,
          position: row.POSITION,
          content: row.CONTENT,
          content_english: row.CONTENT_TRANSLATION_ENGLISH,
          content_spanish: row.CONTENT_TRANSLATION_SPANISH,
          path_image: row.NAME_SCREENSHOT,
          path_audio: row.NAME_AUDIO,
          episodeId: episode.id,
        });

        await segment.save();
      }
    })
  );
}
