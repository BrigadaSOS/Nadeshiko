import type { ListEpisodes, CreateEpisode, GetEpisode, UpdateEpisode, DeleteEpisode } from 'generated/routes/media';
import { Episode, Media, Segment } from '@app/models';
import { SegmentIndexer } from '@app/models/segmentDocument/SegmentIndexer';
import { toEpisodeDTO, toEpisodeListDTO } from './mappers/episodeMapper';
import { encodeKeysetCursor, decodeKeysetCursor } from '@lib/cursor';

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
  const nextCursor = hasMore ? encodeKeysetCursor(episodes[episodes.length - 1].episodeNumber) : null;

  return respond.with200().body({
    episodes: toEpisodeListDTO(episodes, media.publicId),
    pagination: { hasMore, cursor: nextCursor },
  });
};


export const createEpisode: CreateEpisode = async ({ params, body }, respond) => {
  const media = await Media.findOneOrFail({ where: { publicId: params.mediaPublicId } });

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
  });

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

  if (segmentIds.length > 0) {
    await SegmentIndexer.bulkDelete(segmentIds);
  }

  return respond.with204();
};
