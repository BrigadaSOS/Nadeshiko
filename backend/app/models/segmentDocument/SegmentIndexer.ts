import { client, INDEX_NAME } from '@config/elasticsearch';
import { logger } from '@config/log';
import { Media, Segment } from '@app/models';
import { In } from 'typeorm';
import type { t_ReindexResponse } from 'generated/models';
import type { SegmentDocumentShape, ReindexMediaItem } from '../SegmentDocument';

export class SegmentIndexer {
  static async index(segment: Segment): Promise<boolean> {
    try {
      const media = await Media.findOne({ where: { id: segment.mediaId } });
      if (!media) {
        logger.error(`Media with id ${segment.mediaId} not found for segment ${segment.id}`);
        return false;
      }

      await client.index({
        index: INDEX_NAME,
        id: segment.id.toString(),
        document: SegmentIndexer.buildDocument(segment, media),
      });

      logger.info(`Indexed segment ${segment.id} in ES`);
      return true;
    } catch (error: any) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (error?.meta?.statusCode === 404 || errorMessage.includes('document_missing_exception')) {
        logger.warn(`Segment ${segment.id} not found in ES during update (may have been deleted)`);
        return true;
      }
      logger.error(`Failed to index segment ${segment.id} in ES: ${errorMessage}`);
      return false;
    }
  }

  static async delete(id: number): Promise<boolean> {
    try {
      await client.delete({ index: INDEX_NAME, id: id.toString() });
      logger.info(`Deleted segment ${id} from ES`);
      return true;
    } catch (error: any) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (error?.meta?.statusCode === 404 || errorMessage.includes('document_missing_exception')) {
        logger.info(`Segment ${id} already deleted from ES`);
        return true;
      }
      logger.error(`Failed to delete segment ${id} from ES: ${errorMessage}`);
      return false;
    }
  }

  static async reindex(media?: ReindexMediaItem[]): Promise<t_ReindexResponse> {
    const stats = { totalSegments: 0, successfulIndexes: 0, failedIndexes: 0, mediaProcessed: 0 };
    const errors: { segmentId: number; error: string }[] = [];

    try {
      let allSegments: Segment[] = [];
      let uniqueMediaIds = new Set<number>();

      if (!media || media.length === 0) {
        allSegments = await Segment.find();
        uniqueMediaIds = new Set(allSegments.map((s) => s.mediaId));
      } else {
        for (const mediaItem of media) {
          uniqueMediaIds.add(mediaItem.mediaId);

          if (mediaItem.episodes && mediaItem.episodes.length > 0) {
            for (const episodeNumber of mediaItem.episodes) {
              const segments = await Segment.find({ where: { mediaId: mediaItem.mediaId, episode: episodeNumber } });
              allSegments.push(...segments);
            }
          } else {
            const segments = await Segment.find({ where: { mediaId: mediaItem.mediaId } });
            allSegments.push(...segments);
          }
        }
      }

      const mediaList = await Media.find({ where: { id: In([...uniqueMediaIds]) } });
      const mediaMap = new Map(mediaList.map((m) => [m.id, m]));

      stats.totalSegments = allSegments.length;
      stats.mediaProcessed = uniqueMediaIds.size;

      for (const segment of allSegments) {
        const mediaItem = mediaMap.get(segment.mediaId);
        if (!mediaItem) {
          errors.push({ segmentId: segment.id, error: `Media with id ${segment.mediaId} not found` });
          stats.failedIndexes++;
          continue;
        }

        try {
          await client.index({
            index: INDEX_NAME,
            id: segment.id.toString(),
            document: SegmentIndexer.buildDocument(segment, mediaItem),
          });
          stats.successfulIndexes++;
        } catch (error: any) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          errors.push({ segmentId: segment.id, error: errorMessage });
          stats.failedIndexes++;
        }
      }

      logger.info(
        `Reindex completed: ${stats.successfulIndexes}/${stats.totalSegments} segments indexed for ${stats.mediaProcessed} media`,
      );

      return { success: true, message: 'Reindex operation completed', stats, errors };
    } catch (error: any) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Reindex operation failed: ${errorMessage}`);
      return { success: false, message: errorMessage, stats, errors };
    }
  }

  private static buildDocument(segment: Segment, media: Media): SegmentDocumentShape {
    return {
      uuid: segment.uuid,
      position: segment.position,
      status: segment.status,
      startTimeMs: segment.startTimeMs,
      endTimeMs: segment.endTimeMs,
      durationMs: segment.endTimeMs - segment.startTimeMs,
      textJa: segment.contentJa,
      characterCount: segment.contentJa.length,
      textEs: segment.contentEs ?? undefined,
      textEsMt: segment.contentEsMt,
      textEn: segment.contentEn ?? undefined,
      textEnMt: segment.contentEnMt,
      contentRating: segment.contentRating,
      storage: segment.storage,
      hashedId: segment.hashedId,
      category: media.category,
      episode: segment.episode,
      mediaId: segment.mediaId,
      storageBasePath: segment.storageBasePath ?? media.storageBasePath,
    };
  }
}
