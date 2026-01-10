import connection from '../database/db_posgres';
import { addBasicData, readAnimeDirectories, readSpecificDirectory } from '../database/db_initial';
import { invalidateMediaInfoCache } from '../external/database_queries';
import * as elasticsearchSync from '../services/elasticsearchSync';
import type {
  ReSyncDatabase,
  ReSyncDatabasePartial,
  SyncSpecificMedia,
  ReindexSegment,
  ReindexMediaSegments,
  ReindexFullDatabase,
  GetReindexStatus,
} from 'generated/routes/admin';
import type { ReindexResult } from '../models/sync/segmentDocument';

const mediaDirectory: string = process.env.MEDIA_DIRECTORY!;

// Store for tracking background reindex progress
const reindexProgress: Map<string, {
  status: 'running' | 'completed' | 'failed';
  result?: ReindexResult;
  startedAt: Date;
  completedAt?: Date;
}> = new Map();

// Helper to format error response
function errorResponse(code: string, status: number, message: string) {
  return {
    code,
    detail: message,
    status,
    title: message,
  };
}

export const reSyncDatabase: ReSyncDatabase = async (_params, respond) => {
  await connection.sync({ force: true }).then(async () => {
    const db = connection.models;
    await addBasicData(db);
    await readAnimeDirectories(mediaDirectory, 'jdrama');
    await readAnimeDirectories(mediaDirectory, 'anime');
    await readAnimeDirectories(mediaDirectory, 'audiobook');
  });
  invalidateMediaInfoCache();

  return respond.with200().body({ message: 'Database re-synced' });
};

export const reSyncDatabasePartial: ReSyncDatabasePartial = async (_params, respond) => {
  await connection.sync({ alter: true });
  invalidateMediaInfoCache();

  return respond.with200().body({ message: 'Database re-synced without deleting everything' });
};

export const syncSpecificMedia: SyncSpecificMedia = async ({ body }, respond) => {
  const { folder_name, season, episode, force, type } = body;
  const message = await readSpecificDirectory(mediaDirectory, folder_name, force, type, season, episode);

  invalidateMediaInfoCache();

  return respond.with200().body({ message: message });
};

export const reindexSegment: ReindexSegment = async ({ params: { segmentId } }, respond) => {
  if (!segmentId || Number.isNaN(Number(segmentId))) {
    return respond.with400().body(errorResponse('invalid_segment_id', 400, 'Invalid segment ID'));
  }

  const success = await elasticsearchSync.reindexSegmentById(Number(segmentId));
  if (success) {
    return respond.with200().body({ message: `Segment ${segmentId} reindexed to Elasticsearch` });
  } else {
    return respond.with500().body(errorResponse('reindex_failed', 500, `Failed to reindex segment ${segmentId}`));
  }
};

export const reindexMediaSegments: ReindexMediaSegments = async ({ params: { mediaId }, body }, respond) => {
  if (!mediaId || Number.isNaN(Number(mediaId))) {
    return respond.with400().body(errorResponse('invalid_media_id', 400, 'Invalid media ID'));
  }

  const season = body?.season !== undefined ? Number(body.season) : undefined;
  const episode = body?.episode !== undefined ? Number(body.episode) : undefined;

  // Validate season/episode if provided
  if (season !== undefined && Number.isNaN(season)) {
    return respond.with400().body(errorResponse('invalid_season', 400, 'Invalid season number'));
  }
  if (episode !== undefined && Number.isNaN(episode)) {
    return respond.with400().body(errorResponse('invalid_episode', 400, 'Invalid episode number'));
  }

  // Generate a unique reindex ID
  const reindexId = `media-${mediaId}-${Date.now()}`;
  const startedAt = new Date();

  // Return immediately and run reindex in background
  const response = respond.with202().body({
    message: `Started reindexing segments for media ${mediaId}${season !== undefined ? ` season ${season}` : ''}${episode !== undefined ? ` episode ${episode}` : ''} in the background`,
    reindex_id: reindexId,
    media_id: Number(mediaId),
    season: season ?? null,
    episode: episode ?? null,
  });

  // Track progress
  reindexProgress.set(reindexId, { status: 'running', startedAt });

  // Run reindex asynchronously without blocking
  setImmediate(async () => {
    try {
      const result = await elasticsearchSync.reindexMediaSegments({ mediaId: Number(mediaId), season, episode });
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

  return response;
};

export const reindexFullDatabase: ReindexFullDatabase = async (_params, respond) => {
  // Generate a unique reindex ID
  const reindexId = `full-db-${Date.now()}`;
  const startedAt = new Date();

  // Return immediately and run reindex in background
  const response = respond.with202().body({
    message: 'Started full database reindex to Elasticsearch in the background. This may take a while.',
    reindex_id: reindexId,
  });

  // Track progress
  reindexProgress.set(reindexId, { status: 'running', startedAt });

  // Run reindex asynchronously without blocking
  setImmediate(async () => {
    try {
      const result = await elasticsearchSync.reindexFullDatabase((progress) => {
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

  return response;
};

export const getReindexStatus: GetReindexStatus = async (_params, respond) => {
  const failedCount = await elasticsearchSync.getFailedSyncsCount();
  const failedLogs = await elasticsearchSync.getFailedSyncLogs(50);

  // Get all tracked operations (active and recently completed)
  const operations: {
    reindex_id: string;
    status: string;
    started_at: string;
    completed_at?: string | null;
    result?: {
      success?: boolean;
      indexed?: number;
      failed?: number;
      deleted?: number;
      errors?: string[];
    };
  }[] = [];

  reindexProgress.forEach((value, key) => {
    operations.push({
      reindex_id: key,
      status: value.status,
      started_at: value.startedAt.toISOString(),
      completed_at: value.completedAt?.toISOString() ?? null,
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
    return new Date(b.started_at).getTime() - new Date(a.started_at).getTime();
  });

  return respond.with200().body({
    operations,
    failed_sync_count: failedCount,
    failed_sync_logs: failedLogs.map((log) => ({
      id: log.id,
      table_name: log.table_name,
      record_id: log.record_id,
      operation: log.operation,
      error_message: log.error_message,
      retry_count: log.retry_count,
      created_at: log.created_at.toISOString(),
    })),
  } as any);
};
