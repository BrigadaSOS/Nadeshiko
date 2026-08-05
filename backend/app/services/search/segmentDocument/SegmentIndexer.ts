import { client, INDEX_NAME } from '@config/elasticsearch';
import { logger } from '@config/log';
import { Media, Segment } from '@app/models';
import { In, type SelectQueryBuilder } from 'typeorm';
import type { SegmentDocumentShape, ReindexMediaItem } from '../SegmentDocument';
import { isElasticsearchNotFound } from '@lib/elasticsearchErrors';

interface BulkResult {
  succeeded: number;
  failed: number;
  errors: { segmentId: number; error: string }[];
}

export interface ReindexResponse {
  success: boolean;
  message: string;
  stats: {
    totalSegments: number;
    successfulIndexes: number;
    failedIndexes: number;
    mediaProcessed: number;
  };
  errors: { segmentId: number; error: string }[];
}

const REINDEX_CHUNK_SIZE = 500;
const REINDEX_SEGMENT_SELECT_FIELDS: ReadonlyArray<keyof Segment> = [
  'id',
  'uuid',
  'publicId',
  'position',
  'status',
  'startTimeMs',
  'endTimeMs',
  'contentJa',
  'contentEs',
  'contentEsMt',
  'contentEn',
  'contentEnMt',
  'contentRating',
  'storage',
  'hashedId',
  'episode',
  'externalVideoId',
  'mediaId',
  'storageBasePath',
  'tokens',
] as const;

export class SegmentIndexer {
  static async index(segment: Segment): Promise<boolean> {
    try {
      const media = await Media.findOne({ where: { id: segment.mediaId } });
      if (!media) {
        logger.error({ mediaId: segment.mediaId, segmentId: segment.id }, 'Media not found for segment');
        return false;
      }

      await client.index({
        index: INDEX_NAME,
        id: segment.id.toString(),
        document: SegmentIndexer.buildDocument(segment, media),
      });

      logger.info({ segmentId: segment.id }, 'Indexed segment in ES');
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (isElasticsearchNotFound(error) || message.includes('document_missing_exception')) {
        logger.warn({ segmentId: segment.id }, 'Segment not found in ES during update (may have been deleted)');
        return true;
      }
      logger.error({ err: error, segmentId: segment.id }, 'Failed to index segment in ES');
      return false;
    }
  }

  static async bulkIndex(segments: Segment[], targetIndex?: string): Promise<BulkResult> {
    if (segments.length === 0) return { succeeded: 0, failed: 0, errors: [] };

    const indexName = targetIndex ?? INDEX_NAME;
    const mediaIds = [...new Set(segments.map((s) => s.mediaId))];
    const mediaList = await Media.find({ where: { id: In(mediaIds) } });
    const mediaMap = new Map(mediaList.map((m) => [m.id, m]));

    const operations: object[] = [];
    const skippedErrors: BulkResult['errors'] = [];

    for (const segment of segments) {
      const media = mediaMap.get(segment.mediaId);
      if (!media) {
        skippedErrors.push({ segmentId: segment.id, error: `Media with id ${segment.mediaId} not found` });
        continue;
      }
      operations.push({ index: { _index: indexName, _id: segment.id.toString() } });
      operations.push(SegmentIndexer.buildDocument(segment, media));
    }

    if (operations.length === 0) {
      return { succeeded: 0, failed: skippedErrors.length, errors: skippedErrors };
    }

    const response = await client.bulk({ operations });

    let succeeded = 0;
    let failed = skippedErrors.length;
    const errors = [...skippedErrors];

    if (response.errors) {
      for (const item of response.items) {
        const action = item.index;
        if (action?.error) {
          failed++;
          errors.push({
            segmentId: Number(action._id),
            error: action.error.reason ?? JSON.stringify(action.error),
          });
        } else {
          succeeded++;
        }
      }
    } else {
      succeeded = response.items.length;
    }

    logger.info({ succeeded, failed }, 'Bulk indexed segments in ES');
    return { succeeded, failed, errors };
  }

  static async delete(id: number): Promise<boolean> {
    try {
      await client.delete({ index: INDEX_NAME, id: id.toString() });
      logger.info({ segmentId: id }, 'Deleted segment from ES');
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (isElasticsearchNotFound(error) || message.includes('document_missing_exception')) {
        logger.info({ segmentId: id }, 'Segment already deleted from ES');
        return true;
      }
      logger.error({ err: error, segmentId: id }, 'Failed to delete segment from ES');
      return false;
    }
  }

  static async bulkDelete(ids: number[]): Promise<BulkResult> {
    if (ids.length === 0) return { succeeded: 0, failed: 0, errors: [] };

    const operations = ids.flatMap((id) => [{ delete: { _index: INDEX_NAME, _id: id.toString() } }]);

    const response = await client.bulk({ operations });

    let succeeded = 0;
    let failed = 0;
    const errors: BulkResult['errors'] = [];

    for (const item of response.items) {
      const action = item.delete;
      if (action?.error) {
        if (action.error.type === 'document_missing_exception') {
          succeeded++;
        } else {
          failed++;
          errors.push({
            segmentId: Number(action._id),
            error: action.error.reason ?? JSON.stringify(action.error),
          });
        }
      } else {
        succeeded++;
      }
    }

    logger.info({ succeeded, failed }, 'Bulk deleted segments from ES');
    return { succeeded, failed, errors };
  }

  static async reindex(media?: ReindexMediaItem[], targetIndex?: string): Promise<ReindexResponse> {
    const stats = { totalSegments: 0, successfulIndexes: 0, failedIndexes: 0, mediaProcessed: 0 };
    const errors: { segmentId: number; error: string }[] = [];
    const processedMediaIds = new Set<number>();

    try {
      if (!media || media.length === 0) {
        await SegmentIndexer.reindexInPages(
          (lastId) => SegmentIndexer.createReindexQuery().where('segment.id > :lastId', { lastId }),
          stats,
          errors,
          processedMediaIds,
          targetIndex,
        );
        stats.mediaProcessed = processedMediaIds.size;
      } else {
        const requestedMediaIds = new Set<number>();

        for (const mediaItem of media) {
          requestedMediaIds.add(mediaItem.mediaId);

          if (mediaItem.episodes && mediaItem.episodes.length > 0) {
            for (const episodeNumber of mediaItem.episodes) {
              await SegmentIndexer.reindexInPages(
                (lastId) =>
                  SegmentIndexer.createReindexQuery()
                    .where('segment.mediaId = :mediaId', { mediaId: mediaItem.mediaId })
                    .andWhere('segment.episode = :episodeNumber', { episodeNumber })
                    .andWhere('segment.id > :lastId', { lastId }),
                stats,
                errors,
                processedMediaIds,
                targetIndex,
              );
            }
          } else {
            await SegmentIndexer.reindexInPages(
              (lastId) =>
                SegmentIndexer.createReindexQuery()
                  .where('segment.mediaId = :mediaId', { mediaId: mediaItem.mediaId })
                  .andWhere('segment.id > :lastId', { lastId }),
              stats,
              errors,
              processedMediaIds,
              targetIndex,
            );
          }
        }

        stats.mediaProcessed = requestedMediaIds.size;
      }

      logger.info(
        {
          successfulIndexes: stats.successfulIndexes,
          totalSegments: stats.totalSegments,
          mediaProcessed: stats.mediaProcessed,
        },
        'Reindex completed',
      );

      if (stats.failedIndexes > 0 || errors.length > 0) {
        return {
          success: false,
          message: `Reindex completed with ${stats.failedIndexes} failed document(s)`,
          stats,
          errors,
        };
      }

      return { success: true, message: 'Reindex operation completed', stats, errors };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error({ err: error }, 'Reindex operation failed');
      return { success: false, message: errorMessage, stats, errors };
    }
  }

  private static createReindexQuery(): SelectQueryBuilder<Segment> {
    return Segment.createQueryBuilder('segment').select(
      REINDEX_SEGMENT_SELECT_FIELDS.map((field) => `segment.${field}`),
    );
  }

  private static async reindexInPages(
    buildQuery: (lastId: number) => SelectQueryBuilder<Segment>,
    stats: ReindexResponse['stats'],
    errors: { segmentId: number; error: string }[],
    processedMediaIds: Set<number>,
    targetIndex?: string,
  ): Promise<void> {
    let lastId = 0;

    for (;;) {
      const segments = await buildQuery(lastId).orderBy('segment.id', 'ASC').take(REINDEX_CHUNK_SIZE).getMany();
      if (segments.length === 0) {
        return;
      }

      stats.totalSegments += segments.length;
      for (const segment of segments) {
        processedMediaIds.add(segment.mediaId);
      }

      const result = await SegmentIndexer.bulkIndex(segments, targetIndex);
      stats.successfulIndexes += result.succeeded;
      stats.failedIndexes += result.failed;
      errors.push(...result.errors);

      const lastSegment = segments[segments.length - 1];
      if (!lastSegment) return;
      lastId = lastSegment.id;
    }
  }

  private static buildDocument(segment: Segment, media: Media): SegmentDocumentShape {
    return {
      uuid: segment.uuid,
      publicId: segment.publicId,
      position: segment.position,
      status: segment.status,
      startTimeMs: segment.startTimeMs,
      endTimeMs: segment.endTimeMs,
      durationMs: segment.endTimeMs - segment.startTimeMs,
      textJa: segment.contentJa,
      characterCount: segment.contentJa.length,
      textEs: segment.contentEs,
      textEsMt: segment.contentEsMt,
      textEn: segment.contentEn,
      textEnMt: segment.contentEnMt,
      contentRating: segment.contentRating,
      storage: segment.storage,
      hashedId: segment.hashedId,
      category: media.category,
      episode: segment.episode,
      externalVideoId: segment.externalVideoId ?? null,
      mediaId: segment.mediaId,
      storageBasePath: segment.storageBasePath,
      tokens: segment.tokens?.length ? segment.tokens : undefined,
    };
  }
}
