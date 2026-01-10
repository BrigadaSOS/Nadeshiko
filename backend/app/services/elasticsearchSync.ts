import { client } from '@lib/external/elasticsearch';
import { logger } from '@lib/utils/log';
import { SegmentDocument } from '@lib/types/segmentDocument';
import { Segment, Media } from '@app/entities';

const INDEX_NAME = process.env.ELASTICSEARCH_SYNC_INDEX || process.env.ELASTICSEARCH_INDEX || 'nadedb';

function buildSegmentDocument(segment: Segment, media: Media): SegmentDocument {
  return {
    id: segment.id,
    uuid: segment.uuid,
    position: segment.position,
    status: segment.status,
    start_time: segment.startTime ?? '',
    end_time: segment.endTime ?? '',
    content: segment.content ?? '',
    content_length: segment.contentLength,
    content_spanish: segment.contentSpanish,
    content_spanish_mt: segment.contentSpanishMt ? 'true' : 'false',
    content_english: segment.contentEnglish,
    content_english_mt: segment.contentEnglishMt ? 'true' : 'false',
    is_nsfw: segment.isNsfw,
    image_url: segment.imageUrl,
    audio_url: segment.audioUrl,
    actor_ja: segment.actorJa,
    actor_es: segment.actorEs,
    actor_en: segment.actorEn,
    episode: segment.episode,
    media_id: segment.mediaId,
    Media: {
      id: media.id,
      anilist_id: media.anilistId,
      created_at: media.createdAt,
      updated_at: media.updatedAt,
      romaji_name: media.romajiName,
      english_name: media.englishName,
      japanese_name: media.japaneseName,
      airing_format: media.airingFormat,
      airing_status: media.airingStatus,
      genres: media.genres,
      cover_url: media.coverUrl,
      banner_url: media.bannerUrl,
      release_date: media.releaseDate,
      version: media.version,
      category: media.category,
      num_segments: media.numSegments,
      num_episodes: media.episodes?.length ?? 0,
    },
  };
}

export async function syncSegment(segment: Segment, operation: 'CREATE' | 'UPDATE' | 'DELETE'): Promise<boolean> {
  try {
    if (operation === 'DELETE') {
      await client.delete({
        index: INDEX_NAME,
        id: segment.id.toString(),
      });
      logger.info(`Deleted segment ${segment.id} from ES`);
      return true;
    }

    const media = await Media.findOne({
      where: { id: segment.mediaId },
      relations: { episodes: true },
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

    logger.info(`Synced segment ${segment.id} (${operation}) to ES`);
    return true;
  } catch (error: any) {
    // 404 means document doesn't exist, which is fine for CREATE operations
    const errorMessage = error instanceof Error ? error.message : String(error);
    if (error?.meta?.statusCode === 404 || errorMessage.includes('document_missing_exception')) {
      if (operation === 'DELETE') {
        logger.info(`Segment ${segment.id} already deleted from ES`);
        return true;
      }
    }
    logger.error(`Failed to sync segment ${segment.id}: ${errorMessage}`);
    return false;
  }
}
