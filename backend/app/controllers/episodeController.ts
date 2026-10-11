import type { ListEpisodes, CreateEpisode, GetEpisode, UpdateEpisode, DeleteEpisode } from 'generated/routes/media';
import { Episode, Media, Segment } from '@app/models';
import { enqueueSegmentEsDeletes } from './mediaController';
import { toEpisodeDTO, toEpisodeListDTO } from './mappers/episodeMapper';
import { encodeKeysetCursor, decodeKeysetCursor } from '@lib/cursor';
import { Cache } from '@lib/cache';
import { MEDIA_INFO_CACHE } from '@app/models/Media';
import { SegmentDocument } from '@app/services/search/SegmentDocument';

/** Episode writes invalidate both caches because each contains per-media episode totals; media writes already follow
 * this rule. */
function invalidateEpisodeDerivedCaches(): void {
  Cache.invalidate(MEDIA_INFO_CACHE);
  Cache.invalidate(SegmentDocument.SEARCH_STATS_CACHE);
}

export const listEpisodes: ListEpisodes = async ({ params, query }, respond) => {
  // findOneOrFail handles the 404 case if the media doesn't exist
  const media = await Media.findOneOrFail({ where: { publicId: params.mediaPublicId } });

  const take = query.take;
  const afterEpisodeNumber = decodeKeysetCursor<number>(query.cursor);

  const qb = Episode.createQueryBuilder('episode')
    .where('episode.mediaId = :mediaId', { mediaId: media.id })
    .orderBy('episode.episodeNumber', 'ASC')
    .take(take + 1);

  if (afterEpisodeNumber !== undefined) {
    qb.andWhere('episode.episodeNumber > :after', { after: afterEpisodeNumber });
  }

  const rows = await qb.getMany();
  const hasMore = rows.length > take;
  const episodes = hasMore ? rows.slice(0, take) : rows;
  const lastEpisode = episodes[episodes.length - 1];
  const nextCursor = hasMore && lastEpisode ? encodeKeysetCursor(lastEpisode.episodeNumber) : null;

  return respond.with200().body({
    episodes: toEpisodeListDTO(episodes, media.publicId),
    pagination: { hasMore, cursor: nextCursor },
  });
};

export const createEpisode: CreateEpisode = async ({ params, body }, respond) => {
  const media = await Media.findOneOrFail({ where: { publicId: params.mediaPublicId } });

  if (body.externalVideoId) {
    const existing = await Episode.findOne({
      where: { mediaId: media.id, externalVideoId: body.externalVideoId },
    });
    if (existing) {
      return respond.with201().body(toEpisodeDTO(existing, media.publicId));
    }
  }

  const episode = await Episode.save({
    mediaId: media.id,
    episodeNumber: body.episodeNumber,
    titleEn: body.titleEn,
    titleRomaji: body.titleRomaji,
    titleJa: body.titleJa,
    description: body.description,
    airedAt: body.airedAt,
    lengthSeconds: body.lengthSeconds,
    thumbnailUrl: body.thumbnailUrl,
    externalVideoId: body.externalVideoId,
  });

  invalidateEpisodeDerivedCaches();

  return respond.with201().body(toEpisodeDTO(episode, media.publicId));
};

export const getEpisode: GetEpisode = async ({ params }, respond) => {
  const media = await Media.findOneOrFail({ where: { publicId: params.mediaPublicId } });

  const episode = await Episode.findOneOrFail({
    where: {
      mediaId: media.id,
      episodeNumber: params.episodeNumber,
    },
  });

  return respond.with200().body(toEpisodeDTO(episode, media.publicId));
};

export const updateEpisode: UpdateEpisode = async ({ params, body }, respond) => {
  const media = await Media.findOneOrFail({ where: { publicId: params.mediaPublicId } });

  const episode = await Episode.findAndUpdateOrFail({
    where: { mediaId: media.id, episodeNumber: params.episodeNumber },
    patch: body,
  });

  return respond.with200().body(toEpisodeDTO(episode, media.publicId));
};

export const deleteEpisode: DeleteEpisode = async ({ params }, respond) => {
  const media = await Media.findOneOrFail({ where: { publicId: params.mediaPublicId } });

  const segmentIds = await Segment.createQueryBuilder('s')
    .select('s.id')
    .where('s.mediaId = :mediaId AND s.episode = :episode', {
      mediaId: media.id,
      episode: params.episodeNumber,
    })
    .getMany()
    .then((rows) => rows.map((r) => r.id));

  await Episode.deleteOrFail({ where: { mediaId: media.id, episodeNumber: params.episodeNumber } });

  await enqueueSegmentEsDeletes(segmentIds);

  invalidateEpisodeDerivedCaches();

  return respond.with204();
};
