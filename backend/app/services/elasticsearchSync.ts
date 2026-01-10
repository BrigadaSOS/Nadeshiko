import { client } from '@lib/external/elasticsearch';
import { logger } from '@lib/utils/log';
import { SegmentDocument } from '@lib/types/segmentDocument';
import { Segment, Media } from '@app/entities';
import { timeToSeconds } from '@lib/utils/time';
import { In } from 'typeorm';

const INDEX_NAME = process.env.ELASTICSEARCH_SYNC_INDEX || process.env.ELASTICSEARCH_INDEX || 'nadedb';

interface ReindexStats {
  totalSegments: number;
  successfulIndexes: number;
  failedIndexes: number;
  mediaProcessed: number;
}

interface ReindexError {
  segmentId: number;
  error: string;
}

interface ReindexResult {
  success: boolean;
  message: string;
  stats: ReindexStats;
  errors: ReindexError[];
}

export interface ReindexMediaItem {
  mediaId: number;
  episodes?: number[];
}

function buildSegmentDocument(segment: Segment, media: Media): SegmentDocument {
  const startSeconds = timeToSeconds(segment.startTime ?? '');
  const endSeconds = timeToSeconds(segment.endTime ?? '');

  return {
    uuid: segment.uuid,
    position: segment.position,
    status: segment.status,
    startSeconds: startSeconds,
    endSeconds: endSeconds,
    durationSeconds: endSeconds - startSeconds,
    content: segment.content,
    contentLength: segment.contentLength,
    contentSpanish: segment.contentSpanish ?? undefined,
    contentSpanishMt: segment.contentSpanishMt,
    contentEnglish: segment.contentEnglish ?? undefined,
    contentEnglishMt: segment.contentEnglishMt,
    isNsfw: segment.isNsfw,
    storage: segment.storage,
    hashedId: segment.hashedId,
    category: media.category,
    episode: segment.episode,
    mediaId: segment.mediaId,
  };
}

/**
 * Create a new segment document in Elasticsearch.
 * @returns true if successful, false otherwise
 */
export async function createSegmentInES(segment: Segment): Promise<boolean> {
  try {
    const media = await Media.findOne({
      where: { id: segment.mediaId },
    });
    if (!media) {
      logger.error(`Media with id ${segment.mediaId} not found for segment ${segment.id}`);
      return false;
    }

    const document = buildSegmentDocument(segment, media);

    await client.index({
      index: INDEX_NAME,
      id: segment.id.toString(),
      document,
    });

    logger.info(`Created segment ${segment.id} in ES`);
    return true;
  } catch (error: any) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`Failed to create segment ${segment.id} in ES: ${errorMessage}`);
    return false;
  }
}

/**
 * Update an existing segment document in Elasticsearch.
 * @returns true if successful, false otherwise
 */
export async function updateSegmentInES(segment: Segment): Promise<boolean> {
  try {
    const media = await Media.findOne({
      where: { id: segment.mediaId },
    });
    if (!media) {
      logger.error(`Media with id ${segment.mediaId} not found for segment ${segment.id}`);
      return false;
    }

    const document = buildSegmentDocument(segment, media);

    await client.index({
      index: INDEX_NAME,
      id: segment.id.toString(),
      document,
    });

    logger.info(`Updated segment ${segment.id} in ES`);
    return true;
  } catch (error: any) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    // If document doesn't exist, log but don't fail - it might have been deleted
    if (error?.meta?.statusCode === 404 || errorMessage.includes('document_missing_exception')) {
      logger.warn(`Segment ${segment.id} not found in ES during update (may have been deleted)`);
      return true; // Don't retry - document is gone
    }
    logger.error(`Failed to update segment ${segment.id} in ES: ${errorMessage}`);
    return false;
  }
}

/**
 * Delete a segment document from Elasticsearch.
 * @returns true if successful or already deleted, false otherwise
 */
export async function deleteSegmentFromES(id: number): Promise<boolean> {
  try {
    await client.delete({
      index: INDEX_NAME,
      id: id.toString(),
    });
    logger.info(`Deleted segment ${id} from ES`);
    return true;
  } catch (error: any) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    // 404 means document doesn't exist, which is fine - already deleted
    if (error?.meta?.statusCode === 404 || errorMessage.includes('document_missing_exception')) {
      logger.info(`Segment ${id} already deleted from ES`);
      return true;
    }
    logger.error(`Failed to delete segment ${id} from ES: ${errorMessage}`);
    return false;
  }
}

/**
 * Reindex segments from the database into Elasticsearch.
 * Allows filtering by specific media with optional episode filtering.
 *
 * @param media - Array of media items to reindex. Each item has a mediaId and optional episodes array.
 *                If episodes are not provided, all episodes for that media will be reindexed.
 *                If media is not provided, all segments will be reindexed.
 * @returns Reindex result with statistics and errors
 */
export async function reindexSegments(media?: ReindexMediaItem[]): Promise<ReindexResult> {
  const stats: ReindexStats = {
    totalSegments: 0,
    successfulIndexes: 0,
    failedIndexes: 0,
    mediaProcessed: 0,
  };
  const errors: ReindexError[] = [];

  try {
    let allSegments: Segment[] = [];
    let uniqueMediaIds = new Set<number>();

    if (!media || media.length === 0) {
      // Reindex all segments
      allSegments = await Segment.find();
      uniqueMediaIds = new Set(allSegments.map((s) => s.mediaId));
    } else {
      // Build query conditions for each media item
      for (const mediaItem of media) {
        uniqueMediaIds.add(mediaItem.mediaId);

        if (mediaItem.episodes && mediaItem.episodes.length > 0) {
          // Query specific episodes for this media
          for (const episodeNumber of mediaItem.episodes) {
            const segments = await Segment.find({
              where: {
                mediaId: mediaItem.mediaId,
                episode: episodeNumber,
              },
            });
            allSegments.push(...segments);
          }
        } else {
          // Query all segments for this media
          const segments = await Segment.find({
            where: {
              mediaId: mediaItem.mediaId,
            },
          });
          allSegments.push(...segments);
        }
      }
    }

    // Fetch media info for all unique media IDs
    const mediaList = await Media.find({
      where: { id: In([...uniqueMediaIds]) },
    });
    const mediaMap = new Map(mediaList.map((m) => [m.id, m]));

    stats.totalSegments = allSegments.length;
    stats.mediaProcessed = uniqueMediaIds.size;

    // Process each segment
    for (const segment of allSegments) {
      const mediaItem = mediaMap.get(segment.mediaId);
      if (!mediaItem) {
        errors.push({
          segmentId: segment.id,
          error: `Media with id ${segment.mediaId} not found`,
        });
        stats.failedIndexes++;
        continue;
      }

      try {
        const document = buildSegmentDocument(segment, mediaItem);
        await client.index({
          index: INDEX_NAME,
          id: segment.id.toString(),
          document,
        });
        stats.successfulIndexes++;
      } catch (error: any) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        errors.push({
          segmentId: segment.id,
          error: errorMessage,
        });
        stats.failedIndexes++;
      }
    }

    logger.info(
      `Reindex completed: ${stats.successfulIndexes}/${stats.totalSegments} segments indexed for ${stats.mediaProcessed} media`,
    );

    return {
      success: true,
      message: 'Reindex operation completed',
      stats,
      errors,
    };
  } catch (error: any) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`Reindex operation failed: ${errorMessage}`);

    return {
      success: false,
      message: errorMessage,
      stats,
      errors,
    };
  }
}
