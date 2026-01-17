import { StatusCodes } from 'http-status-codes';
import connection from '../database/db_posgres';
import { Response } from 'express';
import { addBasicData, readAnimeDirectories, readSpecificDirectory } from '../database/db_initial';
import { UserSearchHistory } from '../models/miscellaneous/userSearchHistory';
import { logger } from '../utils/log';

const mediaDirectory: string = process.env.MEDIA_DIRECTORY!;

export const reSyncDatabase = async (_req: any, res: Response) => {
  await connection.sync({ force: true }).then(async () => {
    const db = connection.models;
    await addBasicData(db);
    await readAnimeDirectories(mediaDirectory, 'jdrama');
    await readAnimeDirectories(mediaDirectory, 'anime');
    await readAnimeDirectories(mediaDirectory, 'audiobook');
  });
  res.status(StatusCodes.OK).json({ message: 'Database re-synced' });
};

export const reSyncDatabasePartial = async (_req: any, res: Response) => {
  await connection.sync({ alter: true });
  res.status(StatusCodes.OK).json({ message: 'Database re-synced without deleting everything' });
};

export const SyncSpecificMedia = async (req: any, res: Response) => {
  const { folder_name, season, episode, force, type } = req.body;
  const message = await readSpecificDirectory(mediaDirectory, folder_name, season, episode, force, type);
  res.status(StatusCodes.OK).json({ message: message });
};

export const SaveUserSearchHistory = async (EventType: number, Query: any, IP: any, Hits: any) => {
  try {
    const searchLog = await UserSearchHistory.create({
      event_type: EventType,
      query: Query,
      ip_address: IP,
      hits: Hits,
    });
    await searchLog.save();
  } catch (error) {
    logger.error({ err: error, EventType, Query, IP, Hits }, 'Error inserting search log into database');
  }
};
