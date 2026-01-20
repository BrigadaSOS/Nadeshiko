import { Media, CategoryType } from '../models/media/media';
import { Segment, SegmentStatus } from '../models/media/segment';
import { ApiAuth } from '../models/api/apiAuth';
import { User } from '../models/user/user';
import { ApiPermission } from '../models/api/apiPermission';
import { ApiAuthPermission } from '../models/api/ApiAuthPermission';
import { UserRole } from '../models/user/userRole';
import { refreshMediaInfoCache } from '../external/database_queries';
import { logger } from '../utils/log';
import { hashApiKey, generateApiKeyHint } from '../utils/utils';
import { statSync, readFileSync, readdirSync, existsSync, createReadStream, safePath } from '../utils/fs';

import readline from 'readline';
import stream from 'stream';

// Adds the essential content for the database to function
export async function addBasicData(db: any) {
  await db.Role.bulkCreate([
    { id: 1, name: 'ADMIN', description: 'Administrator', quotaLimit: -1 },
    { id: 2, name: 'MOD', description: 'Moderator', quotaLimit: -1 },
    { id: 3, name: 'USER', description: 'User', quotaLimit: 20000 },
    { id: 5, name: 'PATREON', description: 'Patreon', quotaLimit: -1 },
  ]);

  await db.ApiPermission.bulkCreate([
    { name: 'ADD_MEDIA' },
    { name: 'READ_MEDIA' },
    { name: 'REMOVE_MEDIA' },
    { name: 'UPDATE_MEDIA' },
    { name: 'RESYNC_DATABASE' },
    { name: 'CREATE_USER' },
  ]);

  const permissions = ['ADD_MEDIA', 'READ_MEDIA', 'REMOVE_MEDIA', 'UPDATE_MEDIA', 'RESYNC_DATABASE', 'CREATE_USER'];

  const encryptedPassword: string = await Bun.password.hash(process.env.PASSWORD_API_NADEDB!, {
    algorithm: 'bcrypt',
    cost: 10,
  });
  const roles = [1];
  const userRoles = roles.map((roleId) => ({ id_role: roleId }));

  const api_key = process.env.API_KEY_MASTER!;
  const api_key_hashed = hashApiKey(api_key);
  const api_key_hint = generateApiKeyHint(api_key);

  const newUser = await User.create(
    {
      username: process.env.USERNAME_API_NADEDB,
      password: encryptedPassword,
      email: process.env.EMAIL_API_NADEDB,
      is_active: true,
      is_verified: true,
      apiAuth: {
        name: 'Default',
        hint: api_key_hint,
        token: api_key_hashed,
        createdAt: new Date(),
        isActive: true,
      },
      userRoles: userRoles,
    },
    {
      include: [
        { model: ApiAuth, as: 'apiAuth' },
        { model: UserRole, as: 'userRoles' },
      ],
    },
  );

  const apiAuth = newUser.apiAuth;

  const apiPermissions = await ApiPermission.findAll({
    where: {
      name: permissions,
    },
  });

  if (apiAuth) {
    await Promise.all(
      apiPermissions.map(async (permission) => {
        await ApiAuthPermission.create({
          apiAuthId: apiAuth.id,
          apiPermissionId: permission.id,
        });
      }),
    );
  }
}

// Function that reads all directories and maps them in the database
export async function readAnimeDirectories(baseDir: string, type: string) {
  let globalPath = '';
  if (type == 'anime') {
    globalPath = safePath(baseDir, 'anime');
  } else if (type == 'jdrama') {
    globalPath = safePath(baseDir, 'jdrama');
  } else if (type == 'audiobook') {
    globalPath = safePath(baseDir, 'audiobook');
  }

  const animeDirectories = readdirSync(globalPath, { withFileTypes: false });

  for (const animeItem of animeDirectories) {
    const mediaDirPath = safePath(globalPath, animeItem as string);
    // Before creating the MEDIA, verify the existence of a JSON file with the info
    const dataJsonPath = safePath(mediaDirPath, 'info.json');
    const dataJsonExists = existsSync(dataJsonPath);

    let media_raw = null;
    let media = null;

    if (dataJsonExists) {
      try {
        const jsonString = readFileSync(dataJsonPath, 'utf-8') as string;
        media_raw = JSON.parse(jsonString);
      } catch (error) {
        logger.error({ err: error, dataJsonPath }, 'Error reading JSON file');
      }

      try {
        media = await Media.create({
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
          category:
            type == 'anime' ? CategoryType.ANIME : type == 'jdrama' ? CategoryType.JDRAMA : CategoryType.AUDIOBOOK,
          release_date: media_raw.release_date,
          id_category: type == 'anime' ? 1 : type == 'jdrama' ? 3 : 4,
        });

        await media.save();
      } catch (error) {
        logger.error({ err: error, mediaDirPath }, 'Error creating media');
      }

      if (statSync(mediaDirPath).isDirectory()) {
        const seasonDirectories = readdirSync(mediaDirPath, { withFileTypes: true })
          .filter((dirent) => dirent.isDirectory())
          .map((dirent) => dirent.name);

        let numSegments = 0;
        let numSeasons = 0;
        let numEpisodes = 0;
        for (const seasonDirname of seasonDirectories) {
          if (!seasonDirname.startsWith('S')) {
            continue;
          }

          const tempDirPath = safePath(mediaDirPath, seasonDirname);
          numSeasons += 1;

          const media = await Media.findOne({
            where: { romaji_name: media_raw.romaji_name },
          });

          const number_season = parseInt(seasonDirname.replace('S', ''));

          if (statSync(tempDirPath).isDirectory()) {
            const episodeDirectories = readdirSync(tempDirPath, { withFileTypes: false });

            for (const episodeDirname of episodeDirectories) {
              const episodeDirPath = safePath(tempDirPath, episodeDirname as string);
              numEpisodes += 1;

              const number_episode = parseInt(episodeDirname.replace('E', ''));

              const dataTsvPath = safePath(episodeDirPath, 'data.tsv');
              const dataTsvExists = existsSync(dataTsvPath);

              if (dataTsvExists) {
                logger.info({ dataTsvPath, season: number_season, episode: number_episode }, 'Found media data');

                // Read each line through the TSV stream and use the interface to handle it afterwards
                const rl = readline.createInterface({
                  input: createReadStream(dataTsvPath, 'utf-8'),
                  output: new stream.PassThrough(),
                  terminal: false,
                });

                const rows = [];
                let headers;

                // Read each line manually and create our own dictionary
                // To have the freedom to replace each line
                for await (const line of rl) {
                  // Remove backslashes and split the line by the TSV delimiter
                  const rowArray = line.split('\t').map((s: string) => s.replace(/[\\-]/g, ''));
                  if (!headers) {
                    headers = rowArray;
                  } else {
                    // Create an object for the row, using 'headers' for keys and 'rowArray' for values
                    const rowObject = {};
                    headers.forEach((header: string | number, index: string | number) => {
                      // @ts-expect-error -- rowObject index access
                      rowObject[header] = rowArray[index];
                    });
                    rows.push(rowObject);
                  }
                }

                // Realizar inserciones en lotes
                const batchSize = 100;
                const batchCount = Math.ceil(rows.length / batchSize);

                const batchInsertPromises = [];
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
            num_episodes: numEpisodes,
          },
          {
            where: {
              id: media?.id,
            },
          },
        );

        // Refresh cache after modifying Media table
        await refreshMediaInfoCache(0, 10);
      }
    } else {
      logger.warn({ mediaDirPath }, 'data.json file not found, skipping directory');
    }
  }
}

// Function that reads a specific directory and maps it in the database
export async function readSpecificDirectory(
  baseDir: string,
  folder_name: string,
  season: string,
  episode: string,
  force: boolean,
  type: string,
) {
  let mediaDirPath = '';

  if (type == 'anime') {
    mediaDirPath = safePath(baseDir, 'anime', folder_name);
  } else if (type == 'jdrama') {
    mediaDirPath = safePath(baseDir, 'jdrama', folder_name);
  } else if (type == 'audiobook') {
    mediaDirPath = safePath(baseDir, 'audiobook', folder_name);
  }

  // Define the search for content in the database
  let mediaFound = null;
  // Check if the multimedia content exists in the backend
  if (folderExists(mediaDirPath)) {
    // Check if the content exists in the database
    // Check the existence of a JSON file with the info
    const dataJsonPath = safePath(mediaDirPath, 'info.json');
    const dataJsonExists = existsSync(dataJsonPath);

    let media_raw = null;

    if (dataJsonExists) {
      try {
        const jsonString = readFileSync(dataJsonPath, 'utf-8') as string;
        media_raw = JSON.parse(jsonString);
      } catch (error) {
        logger.error({ err: error, dataJsonPath }, 'Error reading JSON file');
        return 'Error reading JSON file: ' + error;
      }
    }

    mediaFound = await Media.findOne({
      where: { folder_media_name: folder_name },
    });

    // If the anime is found, start updating according to parameters
    // Otherwise, add it to the database
    if (mediaFound) {
      if (force) {
        // If only the season is received, force update on the entire season
        // If both season and episode are received, force update of a specific episode of that season
        // If only the episode is received, do nothing
        // If no parameter is received, force a full content update
        // TODO: Leaving this not implemented for now.
        if (season && !episode) {
          return 'Not implemented for now. Please sync the full anime.';
        } else if (season && episode) {
          return 'Not implemented for now. Please sync the full anime.';
        } else if (!season && episode) {
          return 'You must specify a season to delete an episode.';
        } else if (!season && !episode) {
          await mediaFound.destroy();
          try {
            await fullSyncSpecificMedia(mediaFound, media_raw, mediaDirPath, type);
            return 'Media has been added to the database.';
          } catch (error) {
            return error;
          }
        }
      } else {
        return 'Media already exists in the database. If you want to force an update, please check the force option.';
      }
    } else {
      try {
        await fullSyncSpecificMedia(mediaFound, media_raw, mediaDirPath, type);
        return 'Media has been added to the database.';
      } catch (error) {
        return error;
      }
    }
  } else {
    return 'Media folder does not exist. Check the name of the folder and try again.';
  }
}

async function fullSyncSpecificMedia(mediaFound: Media | null, media_raw: any, mediaDirPath: string, type: string) {
  try {
    mediaFound = await Media.create({
      id_anilist: media_raw?.id_anilist ?? null,
      id_tmdb: media_raw?.id_tmdb ?? null,
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
      release_date: media_raw.release_date,
      category: type == 'anime' ? CategoryType.ANIME : type == 'jdrama' ? CategoryType.JDRAMA : CategoryType.AUDIOBOOK,
    });
    await mediaFound.save();
    logger.info(
      { mediaId: mediaFound?.id, folderName: media_raw?.folder_media_anime },
      'Media info inserted into the database',
    );
  } catch (error) {
    logger.error({ err: error, mediaDirPath }, 'Error while inserting media info into the database');
  }

  // Read each season and start mapping it in the database
  const seasonDirectories = readdirSync(mediaDirPath, { withFileTypes: true })
    .filter((dirent) => dirent.isDirectory())
    .map((dirent) => dirent.name);

  let numSegments = 0;
  let numSeasons = 0;
  let numEpisodes = 0;

  for (const seasonDirname of seasonDirectories) {
    if (!seasonDirname.startsWith('S')) {
      continue;
    }

    const number_season = parseInt(seasonDirname.replace('S', ''));
    numSeasons += 1;

    // Once the season is mapped, map the episodes
    const tempDirPath = safePath(mediaDirPath, seasonDirname);
    const isDirectory = statSync(tempDirPath).isDirectory();
    if (isDirectory) {
      const episodeDirectories = readdirSync(tempDirPath, { withFileTypes: false });
      for (const episodeDirname of episodeDirectories) {
        const number_episode = parseInt((episodeDirname as string).replace('E', ''));
        numEpisodes += 1;

        // Once the episode is mapped, map the segments according to the TSV file inside the episode folder
        const episodeDirPath = safePath(tempDirPath, episodeDirname as string);
        const dataTsvPath = safePath(episodeDirPath, 'data.tsv');
        const dataTsvExists = existsSync(dataTsvPath);

        if (dataTsvExists) {
          logger.info({ dataTsvPath, season: number_season, episode: number_episode }, 'Anime data found');

          // Read each line through the TSV stream and use the interface to handle it afterwards
          const rl = readline.createInterface({
            input: createReadStream(dataTsvPath, 'utf-8'),
            output: new stream.PassThrough(),
            terminal: false,
          });

          const rows = [];
          let headers;

          // Read each line manually and create our own dictionary
          // To have the freedom to replace each line
          for await (const line of rl) {
            // Remove backslashes and split the line by the TSV delimiter
            const rowArray = line.split('\t').map((s: string) => s.replace(/[\\-]/g, ''));
            if (!headers) {
              headers = rowArray;
            } else {
              // Create an object for the row, using 'headers' for keys and 'rowArray' for values
              const rowObject = {};
              headers.forEach((header: string | number, index: string | number) => {
                // @ts-expect-error -- rowObject index access
                rowObject[header] = rowArray[index];
              });
              rows.push(rowObject);
            }
          }

          // Realizar inserciones en lotes
          const batchSize = 100;
          const batchCount = Math.ceil(rows.length / batchSize);

          const batchInsertPromises = [];
          for (let i = 0; i < batchCount; i++) {
            const start = i * batchSize;
            const end = start + batchSize;
            const batchRows = rows.slice(start, end);

            batchInsertPromises.push(insertSegments(batchRows, number_season, number_episode, mediaFound!));
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
      num_episodes: numEpisodes,
    },
    {
      where: {
        id: mediaFound?.id,
      },
    },
  );

  // Refresh cache after modifying Media table
  await refreshMediaInfoCache(0, 10);
}

// Helper functions
function folderExists(path: string) {
  try {
    statSync(path);
    return true;
  } catch (err) {
    if (err.code === 'ENOENT') {
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

      if (row.CONTENT === '') {
        logger.warn({ row, season, episode, mediaId: media.id }, 'Empty japanese content - flagging segment');
        status = SegmentStatus.INVALID_SENTENCE;
      } else if (row.CONTENT_TRANSLATION_ENGLISH === '' || row.CONTENT_TRANSLATION_SPANISH === '') {
        logger.warn({ row, season, episode, mediaId: media.id }, 'Empty translation group - flagging segment');
        status = SegmentStatus.INVALID_SENTENCE;
      }
      if (row.CONTENT.length >= 90) {
        logger.warn(
          { row, season, episode, mediaId: media.id, contentLength: row.CONTENT.length },
          'Content longer than 90 chars - flagging segment',
        );
        status = SegmentStatus.SENTENCE_TOO_LONG;
      }

      if (
        row.CONTENT.length >= 500 ||
        row.CONTENT_TRANSLATION_ENGLISH.length >= 500 ||
        row.CONTENT_TRANSLATION_SPANISH.length >= 500
      ) {
        logger.warn(
          {
            row,
            season,
            episode,
            mediaId: media.id,
            contentLengths: {
              jp: row.CONTENT.length,
              en: row.CONTENT_TRANSLATION_ENGLISH.length,
              es: row.CONTENT_TRANSLATION_SPANISH.length,
            },
          },
          'Content longer than 500 characters - skipping segment',
        );
        return;
      }

      const segment = await Segment.create({
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
        media_id: media.id,
      });

      return segment.save();
    }),
  );
}
