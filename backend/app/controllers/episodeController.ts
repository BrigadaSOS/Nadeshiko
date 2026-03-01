import type { ListEpisodes, CreateEpisode, GetEpisode, UpdateEpisode, DeleteEpisode } from 'generated/routes/media';
import { Episode, Media } from '@app/models';
import { toEpisodeDTO, toEpisodeListDTO } from './mappers/episode.mapper';

export const listEpisodes: ListEpisodes = async ({ params, query }, respond) => {
  const media = await Media.findOneOrFail({ where: { publicId: params.mediaId } });

  const { items: episodes, pagination } = await Episode.paginateWithOffset({
    take: query.take,
    cursor: query.cursor,
    exists: {
      entity: Media,
      where: { id: media.id },
    },
    find: {
      where: { mediaId: media.id },
      order: { episodeNumber: 'ASC' },
    },
  });

  return respond.with200().body({
    episodes: toEpisodeListDTO(episodes),
    pagination,
  });
};

export const createEpisode: CreateEpisode = async ({ params, body }, respond) => {
  const media = await Media.findOneOrFail({ where: { publicId: params.mediaId } });

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

  return respond.with201().body(toEpisodeDTO(episode));
};

export const getEpisode: GetEpisode = async ({ params }, respond) => {
  const media = await Media.findOneOrFail({ where: { publicId: params.mediaId } });

  const episode = await Episode.findOneOrFail({
    where: {
      mediaId: media.id,
      episodeNumber: params.episodeNumber,
    },
  });

  return respond.with200().body(toEpisodeDTO(episode));
};

export const updateEpisode: UpdateEpisode = async ({ params, body }, respond) => {
  const media = await Media.findOneOrFail({ where: { publicId: params.mediaId } });

  const episode = await Episode.findAndUpdateOrFail({
    where: { mediaId: media.id, episodeNumber: params.episodeNumber },
    patch: body,
  });

  return respond.with200().body(toEpisodeDTO(episode));
};

export const deleteEpisode: DeleteEpisode = async ({ params }, respond) => {
  const media = await Media.findOneOrFail({ where: { publicId: params.mediaId } });

  await Episode.softDeleteOrFail({ where: { mediaId: media.id, episodeNumber: params.episodeNumber } });

  return respond.with204();
};
