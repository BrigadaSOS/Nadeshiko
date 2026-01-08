import { StatusCodes } from 'http-status-codes';
import connection from '../database/db_posgres';
import { Request, Response, NextFunction } from 'express';
import { addBasicData, readAnimeDirectories, readSpecificDirectory } from '../database/db_initial';
import { UserSearchHistory } from '../models/miscellaneous/userSearchHistory';
import {
  reindexSegmentById,
  reindexMediaSegments,
  reindexFullDatabase,
  getFailedSyncsCount,
  getFailedSyncLogs,
} from '../services/elasticsearchSync';
import { ReindexResult } from '../models/sync/segmentDocument';

const mediaDirectory: string = process.env.MEDIA_DIRECTORY!;

// Store for tracking background reindex progress
const reindexProgress: Map<string, {
  status: 'running' | 'completed' | 'failed';
  result?: ReindexResult;
  startedAt: Date;
  completedAt?: Date;
}> = new Map();

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
 * Reindex a specific segment to Elasticsearch by ID
 */
export const reindexSegment = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { segmentId } = req.params;
    if (!segmentId || isNaN(Number(segmentId))) {
      return res.status(StatusCodes.BAD_REQUEST).json({ error: 'Invalid segment ID' });
    }

    const success = await reindexSegmentById(Number(segmentId));
    if (success) {
      return res.status(StatusCodes.OK).json({ message: `Segment ${segmentId} reindexed to Elasticsearch` });
    } else {
      return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ error: `Failed to reindex segment ${segmentId}` });
    }
  } catch (error) {
    next(error);
  }
};

/**
 * Reindex all segments for a specific media to Elasticsearch
 * Accepts optional season and episode in request body
 * Strategy: Delete all matching segments from ES, then reindex from PostgreSQL
 */
export const reindexMediaSegmentsController = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { mediaId } = req.params;
    const { season, episode } = req.body;

    if (!mediaId || isNaN(Number(mediaId))) {
      return res.status(StatusCodes.BAD_REQUEST).json({ error: 'Invalid media ID' });
    }

    const options = {
      mediaId: Number(mediaId),
      season: season !== undefined ? Number(season) : undefined,
      episode: episode !== undefined ? Number(episode) : undefined,
    };

    // Validate season/episode if provided
    if (options.season !== undefined && isNaN(options.season)) {
      return res.status(StatusCodes.BAD_REQUEST).json({ error: 'Invalid season number' });
    }
    if (options.episode !== undefined && isNaN(options.episode)) {
      return res.status(StatusCodes.BAD_REQUEST).json({ error: 'Invalid episode number' });
    }

    // Generate a unique reindex ID
    const reindexId = `media-${mediaId}-${Date.now()}`;
    const startedAt = new Date();

    // Return immediately and run reindex in background
    res.status(StatusCodes.ACCEPTED).json({
      message: `Started reindexing segments for media ${mediaId}${options.season !== undefined ? ` season ${options.season}` : ''}${options.episode !== undefined ? ` episode ${options.episode}` : ''} in the background`,
      reindex_id: reindexId,
      media_id: Number(mediaId),
      season: options.season,
      episode: options.episode,
    });

    // Track progress
    reindexProgress.set(reindexId, { status: 'running', startedAt });

    // Run reindex asynchronously without blocking
    setImmediate(async () => {
      try {
        const result = await reindexMediaSegments(options);
        reindexProgress.set(reindexId, {
          status: result.success ? 'completed' : 'failed',
          result,
          startedAt,
          completedAt: new Date(),
        });
        console.log(`Background reindex completed for media ${mediaId}: indexed=${result.indexed}, failed=${result.failed}, deleted=${result.deleted}`);
      } catch (error) {
        reindexProgress.set(reindexId, {
          status: 'failed',
          result: {
            success: false,
            indexed: 0,
            failed: 0,
            deleted: 0,
            errors: [error instanceof Error ? error.message : String(error)],
          },
          startedAt,
          completedAt: new Date(),
        });
        console.error(`Background reindex failed for media ${mediaId}:`, error);
      }

      // Clean up old progress entries after 1 hour
      setTimeout(() => {
        reindexProgress.delete(reindexId);
      }, 3600000);
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Reindex the entire database to Elasticsearch
 * Strategy: Process media by media, deleting all ES documents first, then reindexing from PostgreSQL
 * This ensures orphaned documents are removed
 */
export const reindexFullDatabaseController = async (_req: Request, res: Response, next: NextFunction) => {
  try {
    // Generate a unique reindex ID
    const reindexId = `full-db-${Date.now()}`;
    const startedAt = new Date();

    // Return immediately and run reindex in background
    res.status(StatusCodes.ACCEPTED).json({
      message: 'Started full database reindex to Elasticsearch in the background. This may take a while.',
      reindex_id: reindexId,
    });

    // Track progress
    reindexProgress.set(reindexId, { status: 'running', startedAt });

    // Run reindex asynchronously without blocking
    setImmediate(async () => {
      try {
        const result = await reindexFullDatabase((progress) => {
          console.log(`Full DB reindex progress: ${progress.current}/${progress.total} (media: ${progress.mediaId})`);
        });
        reindexProgress.set(reindexId, {
          status: result.success ? 'completed' : 'failed',
          result,
          startedAt,
          completedAt: new Date(),
        });
        console.log(`Full database reindex completed: indexed=${result.indexed}, failed=${result.failed}, deleted=${result.deleted}`);
      } catch (error) {
        reindexProgress.set(reindexId, {
          status: 'failed',
          result: {
            success: false,
            indexed: 0,
            failed: 0,
            deleted: 0,
            errors: [error instanceof Error ? error.message : String(error)],
          },
          startedAt,
          completedAt: new Date(),
        });
        console.error('Full database reindex failed:', error);
      }

      // Clean up old progress entries after 24 hours for full reindex
      setTimeout(() => {
        reindexProgress.delete(reindexId);
      }, 86400000);
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get reindex status: all operations (active + recent) and failed sync logs
 */
export const getReindexStatus = async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const failedCount = await getFailedSyncsCount();
    const failedLogs = await getFailedSyncLogs(50);

    // Get all tracked operations (active and recently completed)
    const operations: {
      reindex_id: string;
      status: string;
      started_at: Date;
      completed_at?: Date;
      result?: {
        success: boolean;
        indexed: number;
        failed: number;
        deleted: number;
        errors: string[];
      };
    }[] = [];

    reindexProgress.forEach((value, key) => {
      operations.push({
        reindex_id: key,
        status: value.status,
        started_at: value.startedAt,
        completed_at: value.completedAt,
        result: value.result ? {
          success: value.result.success,
          indexed: value.result.indexed,
          failed: value.result.failed,
          deleted: value.result.deleted,
          errors: value.result.errors.slice(0, 20),
        } : undefined,
      });
    });

    // Sort: running first, then by started_at desc
    operations.sort((a, b) => {
      if (a.status === 'running' && b.status !== 'running') return -1;
      if (a.status !== 'running' && b.status === 'running') return 1;
      return b.started_at.getTime() - a.started_at.getTime();
    });

    res.status(StatusCodes.OK).json({
      operations,
      failed_sync_count: failedCount,
      failed_sync_logs: failedLogs.map((log) => ({
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
