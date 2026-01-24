import connection from '../database/db_posgres';
import { addBasicData, readAnimeDirectories, readSpecificDirectory } from '../database/db_initial';
import { invalidateMediaCache } from '../external/database_queries';
import type { ReSyncDatabase, ReSyncDatabasePartial, SyncSpecificMedia } from 'generated/routes/admin';

const mediaDirectory: string = process.env.MEDIA_DIRECTORY!;

export const reSyncDatabase: ReSyncDatabase = async (_params, respond) => {
  await connection.sync({ force: true }).then(async () => {
    const db = connection.models;
    await addBasicData(db);
    await readAnimeDirectories(mediaDirectory, 'jdrama');
    await readAnimeDirectories(mediaDirectory, 'anime');
    await readAnimeDirectories(mediaDirectory, 'audiobook');
  });
  invalidateMediaCache();

  return respond.with200().body({ message: 'Database re-synced' });
};

export const reSyncDatabasePartial: ReSyncDatabasePartial = async (_params, respond) => {
  await connection.sync({ alter: true });
  invalidateMediaCache();

  return respond.with200().body({ message: 'Database re-synced without deleting everything' });
};

export const syncSpecificMedia: SyncSpecificMedia = async ({ body }, respond) => {
  const { folder_name, season, episode, force, type } = body;
  const message = await readSpecificDirectory(mediaDirectory, folder_name, force, type, season, episode);

  invalidateMediaCache();

  return respond.with200().body({ message: message });
};
