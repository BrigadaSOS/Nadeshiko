import { client, INDEX_NAME } from '@config/elasticsearch';
import { logger } from '@config/log';
import { Media, Segment } from '@app/models';
import { In } from 'typeorm';
import type { t_ReindexResponse } from 'generated/models';
import type { SegmentDocumentShape, SlimToken, ReindexMediaItem } from '../SegmentDocument';

export interface BulkResult {
  succeeded: number;
  failed: number;
  errors: { segmentId: number; error: string }[];
}

const REINDEX_CHUNK_SIZE = 500;

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

  static async bulkIndex(segments: Segment[]): Promise<BulkResult> {
    if (segments.length === 0) return { succeeded: 0, failed: 0, errors: [] };

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
      operations.push({ index: { _index: INDEX_NAME, _id: segment.id.toString() } });
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

    logger.info(`Bulk indexed ${succeeded} segments (${failed} failed) in ES`);
    return { succeeded, failed, errors };
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

    logger.info(`Bulk deleted ${succeeded} segments (${failed} failed) from ES`);
    return { succeeded, failed, errors };
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

      for (let i = 0; i < allSegments.length; i += REINDEX_CHUNK_SIZE) {
        const chunk = allSegments.slice(i, i + REINDEX_CHUNK_SIZE);

        const validSegments: Segment[] = [];
        for (const segment of chunk) {
          if (!mediaMap.has(segment.mediaId)) {
            errors.push({ segmentId: segment.id, error: `Media with id ${segment.mediaId} not found` });
            stats.failedIndexes++;
          } else {
            validSegments.push(segment);
          }
        }

        if (validSegments.length === 0) continue;

        const operations: object[] = [];
        for (const segment of validSegments) {
          const mediaItem = mediaMap.get(segment.mediaId);
          if (!mediaItem) continue;
          operations.push({ index: { _index: INDEX_NAME, _id: segment.id.toString() } });
          operations.push(SegmentIndexer.buildDocument(segment, mediaItem));
        }

        const response = await client.bulk({ operations });

        if (response.errors) {
          for (const item of response.items) {
            const action = item.index;
            if (action?.error) {
              errors.push({
                segmentId: Number(action._id),
                error: action.error.reason ?? JSON.stringify(action.error),
              });
              stats.failedIndexes++;
            } else {
              stats.successfulIndexes++;
            }
          }
        } else {
          stats.successfulIndexes += response.items.length;
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
      mediaId: segment.mediaId,
      storageBasePath: segment.storageBasePath,
      tokens: SegmentIndexer.extractSlimTokens(segment.posAnalysis),
    };
  }

  private static extractSlimTokens(posAnalysis: Record<string, unknown> | null): SlimToken[] | undefined {
    if (!posAnalysis) return undefined;

    const sudachi = posAnalysis.sudachi;
    if (!Array.isArray(sudachi) || sudachi.length === 0) return undefined;

    return sudachi.map((token: Record<string, unknown>) => {
      const pos = Array.isArray(token.pos) ? token.pos : [];
      const meaningful = (v: unknown) => v !== undefined && v !== '*' && v !== '一般';
      const p1 = pos.length > 1 && meaningful(pos[1]) ? String(pos[1]) : undefined;
      const p2 = pos.length > 2 && meaningful(pos[2]) ? String(pos[2]) : undefined;
      const p4 = pos.length > 4 && meaningful(pos[4]) ? String(pos[4]) : undefined;
      const cf = pos.length > 5 && meaningful(pos[5]) ? String(pos[5]) : undefined;
      const slim: SlimToken = {
        s: String(token.surface ?? ''),
        d: String(token.dictionary_form ?? token.surface ?? ''),
        r: String(token.reading ?? ''),
        b: Number(token.begin ?? 0),
        e: Number(token.end ?? 0),
        p: String(pos[0] ?? ''),
      };
      if (p1) slim.p1 = p1;
      if (p2) slim.p2 = p2;
      if (p4) slim.p4 = p4;
      if (cf) slim.cf = cf;
      return slim;
    });
  }
}
