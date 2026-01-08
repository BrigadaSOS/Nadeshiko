import { client } from '../external/elasticsearch';
import { logger } from '../utils/log';
import { EsSyncLog, SyncOperation, SyncStatus } from '../models/sync/esSyncLog';
import { Segment } from '../models/media/segment';
import { Media } from '../models/media/media';

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;
const INDEX_NAME = process.env.ELASTICSEARCH_SYNC_INDEX || process.env.ELASTICSEARCH_INDEX || 'nadedb';

interface SegmentDocument {
  id: number;
  uuid: string;
  position: number;
  status: number;
  start_time: string | null;
  end_time: string | null;
  content: string | null;
  content_length: number | null;
  content_spanish: string | null;
  content_spanish_mt: boolean | null;
  content_english: string | null;
  content_english_mt: boolean | null;
  is_nsfw: boolean;
  path_image: string | null;
  path_audio: string | null;
  actor_ja: string | null;
  actor_es: string | null;
  actor_en: string | null;
  episode: number;
  season: number;
  media_id: number;
  Media: {
    id: number;
    id_anilist: number | null;
    id_tmdb: number | null;
    created_at: Date;
    updated_at: Date | null;
    romaji_name: string;
    english_name: string | null;
    japanese_name: string | null;
    folder_media_name: string | null;
    airing_format: string | null;
    airing_status: string | null;
    genres: string[] | null;
    cover: string | null;
    banner: string | null;
    release_date: string | null;
    version: string;
    category: number;
    num_segments: number;
    num_seasons: number;
    num_episodes: number;
  };
}

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

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function indexSegment(segment: Segment): Promise<{ success: boolean; error?: string }> {
  try {
    const media = await Media.findByPk(segment.media_id);
    if (!media) {
      return { success: false, error: `Media with id ${segment.media_id} not found` };
    }

    const document = buildSegmentDocument(segment, media);

    await client.index({
      index: INDEX_NAME,
      id: segment.id.toString(),
      document,
    });

    return { success: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return { success: false, error: errorMessage };
  }
}

async function deleteSegment(segmentId: number): Promise<{ success: boolean; error?: string }> {
  try {
    await client.delete({
      index: INDEX_NAME,
      id: segmentId.toString(),
    });

    return { success: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    if (errorMessage.includes('index_not_found_exception') || errorMessage.includes('document_missing_exception')) {
      return { success: true };
    }
    return { success: false, error: errorMessage };
  }
}

async function createSyncLog(
  tableName: string,
  recordId: number,
  operation: SyncOperation,
): Promise<EsSyncLog> {
  return await EsSyncLog.create({
    table_name: tableName,
    record_id: recordId,
    operation,
    status: SyncStatus.PENDING,
  });
}

async function updateSyncLog(
  logEntry: EsSyncLog,
  status: SyncStatus,
  errorMessage?: string,
): Promise<void> {
  await logEntry.update({
    status,
    error_message: errorMessage || null,
    retry_count: logEntry.retry_count + 1,
    last_retry_at: new Date(),
  });
}

export async function syncSegment(
  segment: Segment,
  operation: SyncOperation = SyncOperation.UPDATE,
  retries = MAX_RETRIES,
): Promise<boolean> {
  const logEntry = await createSyncLog('Segment', segment.id, operation);

  let result: Awaited<ReturnType<typeof deleteSegment>> | Awaited<ReturnType<typeof indexSegment>> | undefined;

  for (let attempt = 0; attempt <= retries; attempt++) {
    if (operation === SyncOperation.DELETE) {
      result = await deleteSegment(segment.id);
    } else {
      result = await indexSegment(segment);
    }

    if (result.success) {
      await updateSyncLog(logEntry, SyncStatus.SUCCESS);
      logger.info(`Successfully synced Segment ${segment.id} (${operation}) to ES`);
      return true;
    }

    if (attempt < retries) {
      logger.warn(`Attempt ${attempt + 1} failed for Segment ${segment.id}: ${result.error}. Retrying...`);
      await delay(RETRY_DELAY_MS * (attempt + 1));
    }
  }

  await updateSyncLog(logEntry, SyncStatus.FAILED, result?.error);
  logger.error(`Failed to sync Segment ${segment.id} after ${retries + 1} attempts: ${result?.error}`);
  return false;
}

export async function retryFailedSyncs(): Promise<void> {
  const failedLogs = await EsSyncLog.findAll({
    where: {
      status: SyncStatus.FAILED,
      retry_count: { [require('sequelize').Op.lt]: MAX_RETRIES },
    },
    limit: 100,
  });

  logger.info(`Retrying ${failedLogs.length} failed syncs`);

  for (const log of failedLogs) {
    if (log.table_name === 'Segment') {
      const segment = await Segment.findByPk(log.record_id);
      if (!segment) {
        await log.update({ status: SyncStatus.SUCCESS });
        continue;
      }

      await syncSegment(segment, log.operation);
    }
  }
}

export async function resyncSegmentById(segmentId: number): Promise<boolean> {
  const segment = await Segment.findByPk(segmentId);
  if (!segment) {
    logger.error(`Segment ${segmentId} not found`);
    return false;
  }

  return await syncSegment(segment, SyncOperation.UPDATE);
}

export async function resyncSegmentsByMediaId(mediaId: number): Promise<number> {
  const segments = await Segment.findAll({
    where: { media_id: mediaId },
  });

  let successCount = 0;
  for (const segment of segments) {
    const result = await syncSegment(segment, SyncOperation.UPDATE);
    if (result) successCount++;
  }

  logger.info(`Resynced ${successCount}/${segments.length} segments for media ${mediaId}`);
  return successCount;
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
