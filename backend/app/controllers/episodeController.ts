import type { ListEpisodes, CreateEpisode, GetEpisode, UpdateEpisode, DeleteEpisode } from 'generated/routes/media';
import { Episode, Media } from '@app/models';
import { toEpisodeDTO, toEpisodeListDTO } from './mappers/episode.mapper';

export const listEpisodes: ListEpisodes = async ({ params, query }, respond) => {
  const { items: episodes, pagination } = await Episode.paginateWithOffset({
    take: query.take,
    cursor: query.cursor,
    exists: {
      entity: Media,
      where: { id: params.mediaId },
    },
    find: {
      where: { mediaId: params.mediaId },
      order: { episodeNumber: 'ASC' },
    },
  });

  return respond.with200().body({
    episodes: toEpisodeListDTO(episodes),
    pagination,
  });
};

export const createEpisode: CreateEpisode = async ({ params, body }, respond) => {
  const episode = await Episode.save({
    mediaId: params.mediaId,
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
  const episode = await Episode.findOneOrFail({
    where: {
      mediaId: params.mediaId,
      episodeNumber: params.episodeNumber,
    },
  });

  return respond.with200().body(toEpisodeDTO(episode));
};

export const updateEpisode: UpdateEpisode = async ({ params, body }, respond) => {
  const episode = await Episode.findAndUpdateOrFail({
    where: { mediaId: params.mediaId, episodeNumber: params.episodeNumber },
    patch: body,
  });

  return respond.with200().body(toEpisodeDTO(episode));
};

export const deleteEpisode: DeleteEpisode = async ({ params }, respond) => {
  await Episode.softDeleteOrFail({ where: { mediaId: params.mediaId, episodeNumber: params.episodeNumber } });

  return respond.with204();
};
