import path from "path";
import { Media, CategoryType } from "../models/media/media";
import {Segment, SegmentStatus} from "../models/media/segment";
import { ApiAuth } from "../models/api/apiAuth";
import { User } from "../models/user/user";
import { ApiPermission } from "../models/api/apiPermission";
import { ApiAuthPermission } from "../models/api/ApiAuthPermission";
import crypto from "crypto";
import { UserRole } from "../models/user/userRole";
import {refreshMediaInfoCache} from "../external/database_queries";
import {logger} from "../utils/log";

const bcrypt = require("bcrypt");
const readline = require("readline");
const stream = require("stream");
const fs = require("fs");

function hashApiKey(apiKey: string) {
  const hashedKey = crypto.createHash("sha256").update(apiKey).digest("hex");
  return hashedKey;
}

// Añade el contenido indispensable para el funcionamiento de la base de datos
export async function addBasicData(db: any) {
  await db.Role.bulkCreate([
    { id: 1, name: "ADMIN", description: "Administrator" },
    { id: 2, name: "MOD", description: "Moderator"},
    { id: 3, name: "USER", description: "User" },
  ]);

  await db.ApiPermission.bulkCreate([
    { name: "ADD_ANIME" },
    { name: "READ_ANIME" },
    { name: "REMOVE_ANIME" },
    { name: "UPDATE_ANIME" },
    { name: "RESYNC_DATABASE" },
  ]);

  const permissions = [
    "ADD_ANIME",
    "READ_ANIME",
    "REMOVE_ANIME",
    "UPDATE_ANIME",
    "RESYNC_DATABASE",
  ];

  const salt: string = await bcrypt.genSalt(10);
  const encryptedPassword: string = await bcrypt.hash(process.env.PASSWORD_API_NADEDB, salt);
  const api_key = process.env.API_KEY_MASTER!;
  const roles = [1];
  const userRoles = roles.map((roleId) => ({ id_role: roleId }));

  const newUser = await User.create(
    {
      username: process.env.USERNAME_API_NADEDB,
      password: encryptedPassword,
      email: process.env.EMAIL_API_NADEDB,
      is_active: true,
      is_verified: true,
      apiAuth: {
        token: hashApiKey(api_key),
        createdAt: new Date(),
        isActive: true,
      },
      UserRoles: userRoles
    },
    {
      include: [ApiAuth, UserRole],
    }
  );

  logger.info(`This is your API key: "${api_key}". Please save it. You can only see it once.` );
  const apiAuth = newUser.apiAuth;

  const apiPermissions = await ApiPermission.findAll({
    where: {
      name: permissions,
    },
  });

  await Promise.all(
    apiPermissions.map(async (permission) => {
      await ApiAuthPermission.create({
        apiAuthId: apiAuth.id,
        apiPermissionId: permission.id,
      });
    })
  );
}

// Función que lee todos los directorios y los mapea en la base de datos
export async function readAnimeDirectories(baseDir: string) {
  const animeDirectories = fs.readdirSync(baseDir);

  for (const animeItem of animeDirectories) {
    const animeDirPath = path.join(baseDir, animeItem);
    // Antes de crear el MEDIA, debe verificar la existencia de un archivo JSON con la info
    const dataJsonPath = path.join(animeDirPath, "info.json");
    const dataJsonExists = fs.existsSync(dataJsonPath);

    let media_raw = null;
    let media = null;

    if (dataJsonExists) {
      try {
        const jsonString = fs.readFileSync(dataJsonPath);
        media_raw = JSON.parse(jsonString);
      } catch (error) {
        logger.error( "Error reading JSON file", error);
      }

      try {
        media = await Media.create(
            {
              id: media_raw.id,
              romaji_name: media_raw.romaji_name,
              english_name: media_raw.english_name,
              japanese_name: media_raw.japanese_name,
              folder_media_name: media_raw.folder_media_anime,
              airing_format: media_raw.airing_format,
              airing_status: media_raw.airing_status,
              genres: media_raw.genres,
              cover: media_raw.cover,
              banner: media_raw.banner,
              version: media_raw.version,
              category_type: CategoryType.ANIME,
              id_category: 1,
            }
        );

        await media.save();
      } catch (error) {
        logger.error( "Error creating media", error);
      }

      if (fs.statSync(animeDirPath).isDirectory()) {
        const seasonDirectories = fs
            .readdirSync(animeDirPath, {withFileTypes: true})
            .filter((dirent: { isDirectory: () => any }) => dirent.isDirectory())
            .map((dirent: { name: any }) => dirent.name);

        let numSegments = 0;
        let numSeasons = 0;
        let numEpisodes = 0;
        for (const seasonDirname of seasonDirectories) {
          const tempDirPath = path.join(animeDirPath, seasonDirname);
          numSeasons += 1;

          let media = await Media.findOne({
            where: {romaji_name: media_raw.romaji_name},
          });

          const number_season = parseInt(seasonDirname.replace("S", ""));

          if (fs.statSync(tempDirPath).isDirectory()) {
            const episodeDirectories = fs.readdirSync(tempDirPath);

            for (const episodeDirname of episodeDirectories) {
              const episodeDirPath = path.join(tempDirPath, episodeDirname);
              numEpisodes += 1;

              let number_episode = parseInt(episodeDirname.replace("E", ""));

              const dataTsvPath = path.join(episodeDirPath, "data.tsv");
              const dataTsvExists = fs.existsSync(dataTsvPath);

              if (dataTsvExists) {
                logger.info( `Found anime data: %s`, dataTsvPath);

                // Se lee cada linea mediante el stream del TSV y se usa la interfaz para manejarla despues
                const rl = readline.createInterface({
                  input: fs.createReadStream(dataTsvPath, "utf-8"),
                  output: new stream.PassThrough(),
                  terminal: false,
                });

                const rows = [];
                let headers;

                // Se lee cada linea de forma manual y creamos nuestro propio diccionario
                // Para tener la libertad de reemplazar cada linea
                for await (const line of rl) {
                  // Elimina las barras invertidas y divide la línea por el delimitador de TSV
                  const rowArray = line.split("\t").map((s: string) => s.replace(/[\\\-]/g, ""));
                  if (!headers) {
                    headers = rowArray;
                  } else {
                    // Crea un objeto para la fila, usando 'headers' para las claves y 'rowArray' para los valores
                    const rowObject = {};
                    headers.forEach(
                        (header: string | number, index: string | number) => {
                          //@ts-ignore
                          rowObject[header] = rowArray[index];
                        }
                    );
                    rows.push(rowObject);
                  }
                }

                // Realizar inserciones en lotes
                const batchSize = 100;
                const batchCount = Math.ceil(rows.length / batchSize);

                const batchInsertPromises = []
                for (let i = 0; i < batchCount; i++) {
                  const start = i * batchSize;
                  const end = start + batchSize;
                  const batchRows = rows.slice(start, end);

                  batchInsertPromises.push(insertSegments(batchRows, number_season, number_episode, media!));
                }
                await Promise.all(batchInsertPromises);

                numSegments += rows.length;
              }
            }
          }
        }

        // Set on DB number of segments saved
        await Media.update(
            {
              num_segments: numSegments,
              num_seasons: numSeasons,
              num_episodes: numEpisodes
            },
            {
              where: {
                id: media?.id
              }
            }
        )

        // Refresh cache after modifying Media table
        await refreshMediaInfoCache();
      }
    } else {
      logger.error( `data.json file not found for %s. Skipping...`, animeDirPath);
    }
  }
}

// Función que lee un directorio en especifico y lo mapea en la base de datos
export async function readSpecificDirectory(
  baseDir: string,
  folder_name: string,
  season: string,
  episode: string,
  force: boolean
) {
  // Define la busqueda del anime en la base de datos
  const animeDirPath = path.join(baseDir, folder_name);

  let animeFound = null;
  // Verifica si el contenido multimedia existe en el backend
  if (folderExists(animeDirPath)) {
    // Verifica si existe el anime en la base de datos
    // Verifica la existencia de un archivo JSON con la info
    const dataJsonPath = path.join(animeDirPath, "info.json");
    const dataJsonExists = fs.existsSync(dataJsonPath);

    let media_raw = null;

    if (dataJsonExists) {
      try {
        const jsonString = fs.readFileSync(dataJsonPath);
        media_raw = JSON.parse(jsonString);
      } catch (error) {
        logger.error( `Error reading JSON file %s`, dataJsonPath, error);
        return "Error reading JSON file: " + error;
      }
    }

    animeFound = await Media.findOne({
      where: { folder_media_name: folder_name },
    });

    // Si encuentra el anime, empieza a actualizar de acuerdo a los parametros
    // Caso contrario, lo añade a la base de datos
    if (animeFound) {
      if (force) {
        // Si solo se recibe la temporada, se fuerza la actualización en toda la temporada
        // Si se recibe la temporada y el episodio, se fuerza la actualización de un episodio en especifico de esa temporada
        // Si se recibe solo el episodio, no se hace nada
        // Si no recibe ningún parametro, se fuerza una actualización total del contenido
        // TODO: Leaving this not implemented for now.
        if (season && !episode) {
          return "Not implemented for now. Please sync the full anime.";
        } else if (season && episode) {
          return "Not implemented for now. Please sync the full anime.";
        } else if (!season && episode) {
          return "You must specify a season to delete an episode.";
        } else if (!season && !episode) {
          await animeFound.destroy();
          try {
            await fullSyncSpecificAnime(animeFound, media_raw, animeDirPath);
            return "Anime has been added to the database.";
          } catch (error) {
            return error;
          }
        }
      } else {
        return "Anime already exists in the database. If you want to force an update, please check the force option.";
      }
    } else {
      try {
        await fullSyncSpecificAnime(animeFound, media_raw, animeDirPath);
        return "Anime has been added to the database.";
      } catch (error) {
        return error;
      }
    }
  } else {
    return "Anime folder does not exist. Check the name of the folder and try again.";
  }
}

async function fullSyncSpecificAnime(
  animeFound: Media | null,
  media_raw: any,
  animeDirPath: string
) {
  try {
    animeFound = await Media.create(
      {
        id: media_raw.id,
        romaji_name: media_raw.romaji_name,
        english_name: media_raw.english_name,
        japanese_name: media_raw.japanese_name,
        folder_media_name: media_raw.folder_media_anime,
        airing_format: media_raw.airing_format,
        airing_status: media_raw.airing_status,
        genres: media_raw.genres,
        cover: media_raw.cover,
        banner: media_raw.banner,
        version: media_raw.version,
        category: CategoryType.ANIME,
      }
    );
    await animeFound.save();
    logger.info( "Media info inserted into the database");
  } catch (error) {
    logger.error( "Error while inserting media info into the database", error);
  }

  // Lee cada temporada y empieza a mapearla en la base de datos
  const seasonDirectories = fs
    .readdirSync(animeDirPath, { withFileTypes: true })
    .filter((dirent: { isDirectory: () => any }) => dirent.isDirectory())
    .map((dirent: { name: any }) => dirent.name);

  let numSegments = 0;
  let numSeasons = 0;
  let numEpisodes = 0;
  for (const seasonDirname of seasonDirectories) {
    const number_season = parseInt(seasonDirname.replace("S", ""));
    numSeasons += 1;

    // Una vez mapeada la temporada, mapea los episodios
    const tempDirPath = path.join(animeDirPath, seasonDirname);
    if (fs.statSync(tempDirPath).isDirectory()) {
      const episodeDirectories = fs.readdirSync(tempDirPath);
      for (const episodeDirname of episodeDirectories) {
        const number_episode = parseInt(episodeDirname.replace("E", ""));
        numEpisodes += 1;

        // Una vez mapeado el episodio, mapea los segmentos de acuerdo al archivo TSV dentro de la carpeta del episodio
        const episodeDirPath = path.join(tempDirPath, episodeDirname);
        const dataTsvPath = path.join(episodeDirPath, "data.tsv");
        const dataTsvExists = fs.existsSync(dataTsvPath);

        if (dataTsvExists) {
          logger.info( `Anime data has been found: ${dataTsvPath}`)

          // Se lee cada linea mediante el stream del TSV y se usa la interfaz para manejarla despues
          const rl = readline.createInterface({
            input: fs.createReadStream(dataTsvPath, "utf-8"),
            output: new stream.PassThrough(),
            terminal: false,
          });

          const rows = [];
          let headers;

          // Se lee cada linea de forma manual y creamos nuestro propio diccionario
          // Para tener la libertad de reemplazar cada linea
          for await (const line of rl) {
            // Elimina las barras invertidas y divide la línea por el delimitador de TSV
            const rowArray = line.split("\t").map((s: string) => s.replace(/[\\\-]/g, ""));
            if (!headers) {
              headers = rowArray;
            } else {
              // Crea un objeto para la fila, usando 'headers' para las claves y 'rowArray' para los valores
              const rowObject = {};
              headers.forEach(
                (header: string | number, index: string | number) => {
                  //@ts-ignore
                  rowObject[header] = rowArray[index];
                }
              );
              rows.push(rowObject);
            }
          }

          // Realizar inserciones en lotes
          const batchSize = 100;
          const batchCount = Math.ceil(rows.length / batchSize);

          const batchInsertPromises = []
          for (let i = 0; i < batchCount; i++) {
            const start = i * batchSize;
            const end = start + batchSize;
            const batchRows = rows.slice(start, end);

            batchInsertPromises.push(insertSegments(batchRows, number_season, number_episode, animeFound!));
          }
          await Promise.all(batchInsertPromises);

          numSegments += rows.length;
        }
      }
    }
  }

  // Set on DB number of segments saved
  await Media.update(
      {
        num_segments: numSegments,
        num_seasons: numSeasons,
        num_episodes: numEpisodes
      },
      {
        where: {
          id: animeFound?.id
        }
      }
  )

  // Refresh cache after modifying Media table
  await refreshMediaInfoCache();
}

// Funciones menores
function folderExists(path: string) {
  try {
    fs.statSync(path);
    return true;
  } catch (err) {
    if (err.code === "ENOENT") {
      return false;
    } else {
      throw err;
    }
  }
}

async function insertSegments(rows: any[], season: number, episode: number, media: Media) {
  return Promise.all(
    rows.map(async (row: any) => {
      let status = SegmentStatus.ACTIVE;

      if (row.CONTENT === "") {
        logger.info( `Empty japanese content. Flagging row... %s`, row);
        status = SegmentStatus.INVALID_SENTENCE;
      }
      else if (
        row.CONTENT_TRANSLATION_ENGLISH === "" ||
        row.CONTENT_TRANSLATION_SPANISH === ""
      ) {
        logger.info( `Empty translation group. Flagging row... %s`, row);
        status = SegmentStatus.INVALID_SENTENCE;
      }
      if (
        row.CONTENT.length >= 100
      ) {
        logger.info(`Content longer than 100 chars. Flagging row... %s`, row);
        status = SegmentStatus.SENTENCE_TOO_LONG;
      }

      if (
          row.CONTENT.length >= 400 ||
          row.CONTENT_TRANSLATION_ENGLISH.length >= 400 ||
          row.CONTENT_TRANSLATION_SPANISH.length >= 400
      ) {
        logger.info( `Content longer than 400 characters. Can not save row, skipping... %s`, row);
        return;
      }

      let segment = await Segment.create({
        start_time: row.START_TIME,
        end_time: row.END_TIME,
        position: row.ID,
        status: status,
        content: row.CONTENT,
        content_english: row.CONTENT_TRANSLATION_ENGLISH,
        content_english_mt: row.CONTENT_ENGLISH_MT,
        content_spanish: row.CONTENT_TRANSLATION_SPANISH,
        content_spanish_mt: row.CONTENT_SPANISH_MT,
        path_image: row.NAME_SCREENSHOT,
        path_audio: row.NAME_AUDIO,
        actor_ja: row.ACTOR_JA,
        actor_es: row.ACTOR_ES,
        actor_en: row.ACTOR_EN,
        season: season,
        episode: episode,
        media_id: media.id
      });

      return segment.save();
    })
  );
}
