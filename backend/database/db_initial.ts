import path from "path";
import { Media } from "../models/media/media";
import { Season } from "../models/media/season";
import { Episode } from "../models/media/episode";
import { Segment } from "../models/media/segment";
import { Category } from "../models/media/category";

const fs = require("fs");
const csv = require("csv-parser");

export async function addBasicData(db: any) {
  await db.Category.create({
    name: "Anime",
  });

  await db.Category.create({
    name: "Book",
  });
}

export async function readAnimeDirectories(baseDir: string) {
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

              const stream = fs
                .createReadStream(dataCsvPath)
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

export async function insertSegments(rows: any[], episode: Episode | null) {
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
