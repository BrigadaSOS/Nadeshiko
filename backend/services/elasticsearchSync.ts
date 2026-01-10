import { client } from '../external/elasticsearch';
import { logger } from '../utils/log';
import { EsSyncLog, SyncOperation, SyncStatus } from '../models/sync/esSyncLog';
import {
  SegmentDocument,
  ReindexMediaOptions,
  ReindexResult,
  ReindexProgressCallback,
} from '../models/sync/segmentDocument';
import { Segment } from '../models/media/segment';
import { Media } from '../models/media/media';
import { Op } from 'sequelize';

const BATCH_SIZE = 500;
const MAX_RETRY_COUNT = 10; // Maximum number of times cron job will retry a failed operation
const INDEX_NAME = process.env.ELASTICSEARCH_SYNC_INDEX || process.env.ELASTICSEARCH_INDEX || 'nadedb';

function buildSegmentDocument(segment: Segment, media: Media): SegmentDocument {
  return {
    id: segment.id,
    uuid: segment.uuid,
    position: segment.position,
    status: segment.status,
    start_time: segment.start_time,
    end_time: segment.end_time,
    content: segment.content,
    content_length: segment.content_length,
    content_spanish: segment.content_spanish,
    content_spanish_mt: segment.content_spanish_mt,
    content_english: segment.content_english,
    content_english_mt: segment.content_english_mt,
    is_nsfw: segment.is_nsfw,
    path_image: segment.path_image,
    path_audio: segment.path_audio,
    actor_ja: segment.actor_ja,
    actor_es: segment.actor_es,
    actor_en: segment.actor_en,
    episode: segment.episode,
    season: segment.season,
    media_id: segment.media_id,
    Media: {
      id: media.id,
      id_anilist: media.id_anilist,
      id_tmdb: media.id_tmdb,
      created_at: media.created_at,
      updated_at: media.updated_at,
      romaji_name: media.romaji_name,
      english_name: media.english_name,
      japanese_name: media.japanese_name,
      folder_media_name: media.folder_media_name,
      airing_format: media.airing_format,
      airing_status: media.airing_status,
      genres: media.genres,
      cover: media.cover,
      banner: media.banner,
      release_date: media.release_date,
      version: media.version,
      category: media.category,
      num_segments: media.num_segments,
      num_seasons: media.num_seasons,
      num_episodes: media.num_episodes,
    },
  };
}

async function indexSegment(segment: Segment): Promise<{ success: boolean; error?: string; retriable?: boolean }> {
  try {
    const media = await Media.findByPk(segment.media_id);
    if (!media) {
      // Permanent error - media doesn't exist, no point retrying
      return { success: false, error: `Media with id ${segment.media_id} not found`, retriable: false };
    }

    const document = buildSegmentDocument(segment, media);

    await client.index({
      index: INDEX_NAME,
      id: segment.id.toString(),
      document,
    });

    return { success: true };
  } catch (error) {
    // Elasticsearch errors - typically transient (connection, timeout, etc.)
    const errorMessage = error instanceof Error ? error.message : String(error);
    return { success: false, error: errorMessage, retriable: true };
  }
}

async function deleteSegmentFromES(segmentId: number): Promise<{ success: boolean; error?: string; retriable?: boolean }> {
  try {
    await client.delete({
      index: INDEX_NAME,
      id: segmentId.toString(),
    });

    return { success: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    if (error?.meta?.statusCode === 404 || errorMessage.includes('document_missing_exception')) {
      return { success: true };
    }
    // Elasticsearch errors - typically transient (connection, timeout, etc.)
    return { success: false, error: errorMessage, retriable: true };
  }
}

async function deleteMediaSegmentsFromES(
  mediaId: number,
  season?: number,
  episode?: number,
): Promise<{ deleted: number; errors: string[] }> {
  const errors: string[] = [];
  let deleted = 0;

  try {
    const query: any = {
      bool: {
        must: [{ term: { media_id: mediaId } }],
      },
    };

    if (season !== undefined) {
      query.bool.must.push({ term: { season } });
    }

    if (episode !== undefined) {
      query.bool.must.push({ term: { episode } });
    }

    const result = await client.deleteByQuery({
      index: INDEX_NAME,
      query,
      refresh: true,
    });

    deleted = result.deleted || 0;

    if (result.failures && result.failures.length > 0) {
      errors.push(...result.failures.map((f: any) => f.cause?.reason || 'Unknown deletion error'));
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    errors.push(errorMessage);
  }

  return { deleted, errors };
}

async function findOrCreateSyncLog(
  tableName: string,
  recordId: number,
  operation: SyncOperation,
): Promise<EsSyncLog> {
  const [logEntry] = await EsSyncLog.findOrCreate({
    where: {
      table_name: tableName,
      record_id: recordId,
      operation,
      status: SyncStatus.FAILED,
    },
    defaults: {
      table_name: tableName,
      record_id: recordId,
      operation,
      status: SyncStatus.FAILED,
      retry_count: 0,
    },
  });
  return logEntry;
}

export async function syncSegment(
  segment: Segment,
  operation: SyncOperation = SyncOperation.UPDATE,
  existingLog?: EsSyncLog,
): Promise<boolean> {
  // Try the operation once
  let result: Awaited<ReturnType<typeof deleteSegmentFromES>> | Awaited<ReturnType<typeof indexSegment>>;

  if (operation === SyncOperation.DELETE) {
    result = await deleteSegmentFromES(segment.id);
  } else {
    result = await indexSegment(segment);
  }

  if (result.success) {
    // If this was a retry and we have an existing log, delete it
    if (existingLog) {
      await existingLog.destroy();
      logger.info(`Successfully synced Segment ${segment.id} (${operation}) to ES on retry - removed from failed log`);
    } else {
      logger.info(`Successfully synced Segment ${segment.id} (${operation}) to ES`);
    }
    return true;
  }

  // If the error is not retriable, don't log it for retry
  if (result.retriable === false) {
    logger.error(`Non-retriable error for Segment ${segment.id}: ${result.error}. Will not retry.`);
    return false;
  }

  // Operation failed with a retriable error - log it for the cron job to retry
  if (existingLog) {
    await existingLog.update({
      error_message: result.error || null,
      retry_count: existingLog.retry_count + 1,
      last_retry_at: new Date(),
    });
  } else {
    await EsSyncLog.create({
      table_name: 'Segment',
      record_id: segment.id,
      operation,
      status: SyncStatus.FAILED,
      error_message: result.error || null,
      retry_count: 0,
      last_retry_at: new Date(),
    });
  }

  logger.error(`Failed to sync Segment ${segment.id}: ${result.error}. Will be retried by cron job.`);
  return false;
}

export async function retryFailedSyncs(): Promise<void> {
  const failedLogs = await EsSyncLog.findAll({
    where: {
      status: SyncStatus.FAILED,
      retry_count: { [Op.lt]: MAX_RETRY_COUNT },
    },
    limit: 100,
  });

  logger.info(`Retrying ${failedLogs.length} failed syncs`);

  for (const log of failedLogs) {
    if (log.table_name === 'Segment') {
      const segment = await Segment.findByPk(log.record_id);
      if (!segment) {
        // Segment was deleted, remove the log entry
        await log.destroy();
        logger.info(`Segment ${log.record_id} no longer exists - removed from failed log`);
        continue;
      }

      // Pass the existing log to avoid creating a duplicate
      await syncSegment(segment, log.operation, log);
    }
  }
}

export async function reindexSegmentById(segmentId: number): Promise<boolean> {
  const segment = await Segment.findByPk(segmentId);
  if (!segment) {
    logger.error(`Segment ${segmentId} not found`);
    return false;
  }

  return await syncSegment(segment, SyncOperation.UPDATE);
}

export async function reindexMediaSegments(
  options: ReindexMediaOptions,
  onProgress?: ReindexProgressCallback,
): Promise<ReindexResult> {
  const { mediaId, season, episode } = options;
  const result: ReindexResult = {
    success: true,
    indexed: 0,
    failed: 0,
    deleted: 0,
    errors: [],
  };

  logger.info(`Starting reindex for media ${mediaId}${season !== undefined ? ` season ${season}` : ''}${episode !== undefined ? ` episode ${episode}` : ''}`);

  // Step 1: Delete all existing segments from ES for this media/season/episode
  onProgress?.({ phase: 'deleting', current: 0, total: 1, mediaId });

  const deleteResult = await deleteMediaSegmentsFromES(mediaId, season, episode);
  result.deleted = deleteResult.deleted;
  result.errors.push(...deleteResult.errors);

  logger.info(`Deleted ${result.deleted} existing segments from ES for media ${mediaId}`);

  // Step 2: Build query for PostgreSQL segments
  const whereClause: any = { media_id: mediaId };
  if (season !== undefined) {
    whereClause.season = season;
  }
  if (episode !== undefined) {
    whereClause.episode = episode;
  }

  // Step 3: Fetch media once (not inside the loop)
  const media = await Media.findByPk(mediaId);
  if (!media) {
    result.errors.push(`Media ${mediaId} not found`);
    result.success = false;
    return result;
  }

  // Step 4: Get total count for progress
  const totalCount = await Segment.count({ where: whereClause });
  onProgress?.({ phase: 'indexing', current: 0, total: totalCount, mediaId });

  // Step 5: Process in batches
  let offset = 0;

  while (true) {
    const segments = await Segment.findAll({
      where: whereClause,
      limit: BATCH_SIZE,
      offset,
      order: [['id', 'ASC']],
    });

    if (segments.length === 0) break;

    // Index segments in bulk
    const bulkBody: any[] = [];
    for (const segment of segments) {
      const document = buildSegmentDocument(segment, media);
      bulkBody.push({ index: { _index: INDEX_NAME, _id: segment.id.toString() } });
      bulkBody.push(document);
    }

    try {
      const bulkResponse = await client.bulk({ body: bulkBody, refresh: false });

      if (bulkResponse.errors) {
        for (const item of bulkResponse.items) {
          if (item.index?.error) {
            result.failed++;
            result.errors.push(`Segment ${item.index._id}: ${item.index.error.reason}`);
          } else {
            result.indexed++;
          }
        }
      } else {
        result.indexed += segments.length;
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      result.errors.push(`Bulk indexing error: ${errorMessage}`);
      result.failed += segments.length;
      result.success = false;
    }

    offset += segments.length;
    onProgress?.({ phase: 'indexing', current: offset, total: totalCount, mediaId });
  }

  // Refresh index after all operations
  try {
    await client.indices.refresh({ index: INDEX_NAME });
  } catch (error) {
    logger.warn(`Failed to refresh index: ${error}`);
  }

  logger.info(`Reindex complete for media ${mediaId}: indexed=${result.indexed}, failed=${result.failed}, deleted=${result.deleted}`);

  if (result.errors.length > 0) {
    result.success = result.failed === 0;
  }

  return result;
}

export async function reindexFullDatabase(
  onProgress?: ReindexProgressCallback,
): Promise<ReindexResult> {
  const result: ReindexResult = {
    success: true,
    indexed: 0,
    failed: 0,
    deleted: 0,
    errors: [],
  };

  logger.info('Starting full database reindex to Elasticsearch');

  // Get all media
  const allMedia = await Media.findAll({
    attributes: ['id', 'romaji_name'],
    order: [['id', 'ASC']],
  });

  const totalMedia = allMedia.length;
  logger.info(`Found ${totalMedia} media to reindex`);

  for (let i = 0; i < allMedia.length; i++) {
    const media = allMedia[i];

    onProgress?.({
      phase: 'indexing',
      current: i + 1,
      total: totalMedia,
      mediaId: media.id,
    });

    logger.info(`Reindexing media ${i + 1}/${totalMedia}: ${media.romaji_name} (ID: ${media.id})`);

    try {
      const mediaResult = await reindexMediaSegments({ mediaId: media.id });

      result.indexed += mediaResult.indexed;
      result.failed += mediaResult.failed;
      result.deleted += mediaResult.deleted;
      result.errors.push(...mediaResult.errors.slice(0, 10));

      if (!mediaResult.success) {
        logger.warn(`Media ${media.id} reindex had failures: ${mediaResult.failed} failed`);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      result.errors.push(`Media ${media.id}: ${errorMessage}`);
      logger.error(`Failed to reindex media ${media.id}: ${errorMessage}`);
    }
  }

  onProgress?.({ phase: 'complete', current: totalMedia, total: totalMedia });

  // Final refresh
  try {
    await client.indices.refresh({ index: INDEX_NAME });
  } catch (error) {
    logger.warn(`Failed to refresh index: ${error}`);
  }

  result.success = result.failed === 0;

  logger.info(`Full database reindex complete: indexed=${result.indexed}, failed=${result.failed}, deleted=${result.deleted}`);

  return result;
}

export async function getFailedSyncsCount(): Promise<number> {
  return await EsSyncLog.count({
    where: {
      status: SyncStatus.FAILED,
    },
  });
}

export async function getFailedSyncLogs(limit = 50): Promise<EsSyncLog[]> {
  return await EsSyncLog.findAll({
    where: {
      status: SyncStatus.FAILED,
    },
    order: [['created_at', 'DESC']],
    limit,
  });
}
