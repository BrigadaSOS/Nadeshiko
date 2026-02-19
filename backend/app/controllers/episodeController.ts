import type { ListEpisodes, CreateEpisode, GetEpisode, UpdateEpisode, DeleteEpisode } from 'generated/routes/media';
import { Episode, Media } from '@app/models';
import { toEpisodeDTO, toEpisodeListDTO } from './mappers/episode.mapper';

export const listEpisodes: ListEpisodes = async ({ params, query }, respond) => {
  await Media.findOneOrFail({ where: { id: params.mediaId } });

  const [episodes, count] = await Episode.findAndCount({
    where: { mediaId: params.mediaId },
    order: { episodeNumber: 'ASC' },
    take: query.limit,
    skip: query.cursor,
  });

  const nextCursor = query.cursor + count;
  const hasMore = count === query.limit;

  return respond.with200().body({
    episodes: toEpisodeListDTO(episodes),
    pagination: {
      hasMore,
      cursor: hasMore ? nextCursor : null,
    },
  });
};

export const createEpisode: CreateEpisode = async ({ params, body }, respond) => {
  await Media.findOneOrFail({ where: { id: params.mediaId } });

  const episode = Episode.create({
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

  await episode.save();

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
  const episode = await Episode.findOneOrFail({
    where: {
      mediaId: params.mediaId,
      episodeNumber: params.episodeNumber,
    },
  });

  Episode.merge(episode, body);
  await episode.save();

  return respond.with200().body(toEpisodeDTO(episode));
};

export const deleteEpisode: DeleteEpisode = async ({ params }, respond) => {
  const episode = await Episode.findOneOrFail({
    where: {
      mediaId: params.mediaId,
      episodeNumber: params.episodeNumber,
    },
  });

  await episode.softRemove();

  return respond.with204();
};
