import { StatusCodes } from 'http-status-codes';
import connection from '../database/db_posgres';
import { Request, Response, NextFunction } from 'express';
import { addBasicData, readAnimeDirectories, readSpecificDirectory } from '../database/db_initial';
import { UserSearchHistory } from '../models/miscellaneous/userSearchHistory';
import {
  resyncSegmentById,
  resyncSegmentsByMediaId,
  getFailedSyncsCount,
  getFailedSyncLogs,
} from '../services/elasticsearchSync';

const mediaDirectory: string = process.env.MEDIA_DIRECTORY!;

export const reSyncDatabase = async (_req: Request, res: Response, next: NextFunction) => {
  try {
    await connection.sync({ force: true }).then(async () => {
      const db = connection.models;
      await addBasicData(db);
      await readAnimeDirectories(mediaDirectory, 'jdrama');
      await readAnimeDirectories(mediaDirectory, 'anime');
      await readAnimeDirectories(mediaDirectory, 'audiobook');
    });
    res.status(StatusCodes.OK).json({ message: 'Database re-synced' });
  } catch (error) {
    next(error);
  }
};

export const reSyncDatabasePartial = async (_req: Request, res: Response, next: NextFunction) => {
  try {
    await connection.sync({ alter: true });
    res.status(StatusCodes.OK).json({ message: 'Database re-synced without deleting everything' });
  } catch (error) {
    next(error);
  }
};

export const SyncSpecificMedia = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { folder_name, season, episode, force, type } = req.body;
    const message = await readSpecificDirectory(mediaDirectory, folder_name, season, episode, force, type);
    res.status(StatusCodes.OK).json({ message: message });
  } catch (error) {
    next(error);
  }
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
    console.log('Error while inserting search log into the database', error);
  }
};

/**
 * Resync a specific segment to Elasticsearch by ID
 */
export const resyncSegment = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { segmentId } = req.params;
    if (!segmentId || isNaN(Number(segmentId))) {
      return res.status(StatusCodes.BAD_REQUEST).json({ error: 'Invalid segment ID' });
    }

    const success = await resyncSegmentById(Number(segmentId));
    if (success) {
      res.status(StatusCodes.OK).json({ message: `Segment ${segmentId} synced to Elasticsearch` });
    } else {
      res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ error: `Failed to sync segment ${segmentId}` });
    }
  } catch (error) {
    next(error);
  }
};

/**
 * Resync all segments for a specific media to Elasticsearch
 */
export const resyncMediaSegments = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { mediaId } = req.params;
    if (!mediaId || isNaN(Number(mediaId))) {
      return res.status(StatusCodes.BAD_REQUEST).json({ error: 'Invalid media ID' });
    }

    // Return immediately and run sync in background
    res.status(StatusCodes.ACCEPTED).json({
      message: `Started syncing segments for media ${mediaId} in the background`,
      media_id: Number(mediaId),
    });

    // Run sync asynchronously without blocking
    setImmediate(async () => {
      try {
        const count = await resyncSegmentsByMediaId(Number(mediaId));
        console.log(`Background sync completed: ${count} segments synced for media ${mediaId}`);
      } catch (error) {
        console.error(`Background sync failed for media ${mediaId}:`, error);
      }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get failed sync logs
 */
export const getSyncStatus = async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const failedCount = await getFailedSyncsCount();
    const failedLogs = await getFailedSyncLogs(50);

    res.status(StatusCodes.OK).json({
      failed_count: failedCount,
      failed_logs: failedLogs.map((log) => ({
        id: log.id,
        table_name: log.table_name,
        record_id: log.record_id,
        operation: log.operation,
        error_message: log.error_message,
        retry_count: log.retry_count,
        created_at: log.created_at,
      })),
    });
  } catch (error) {
    next(error);
  }
};
