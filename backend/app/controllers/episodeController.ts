import type { EpisodeIndex, EpisodeCreate, EpisodeShow, EpisodeUpdate, EpisodeDestroy } from 'generated/routes/media';
import { Episode, Media } from '@app/entities';
import { toEpisodeDTO, toEpisodeListDTO } from './mappers/episode.mapper';

export const episodeIndex: EpisodeIndex = async ({ params, query }, respond) => {
  await Media.findOneOrFail({ where: { id: params.mediaId } });

  const [episodes, count] = await Episode.findAndCount({
    where: { mediaId: params.mediaId },
    order: { episodeNumber: 'ASC' },
    take: query.size,
    skip: query.cursor,
  });

  const nextCursor = query.cursor + count;
  const hasMoreResults = count === query.size;

  return respond.with200().body({
    data: toEpisodeListDTO(episodes),
    cursor: hasMoreResults ? nextCursor : undefined,
    hasMoreResults,
  });
};

export const episodeCreate: EpisodeCreate = async ({ params, body }, respond) => {
  await Media.findOneOrFail({ where: { id: params.mediaId } });

  const episode = Episode.create({
    mediaId: params.mediaId,
    episodeNumber: body.episodeNumber,
    anilistEpisodeId: body.anilistEpisodeId,
    titleEnglish: body.titleEnglish,
    titleRomaji: body.titleRomaji,
    titleJapanese: body.titleJapanese,
    description: body.description,
    airedAt: body.airedAt,
    lengthSeconds: body.lengthSeconds,
    thumbnailUrl: body.thumbnailUrl,
  });

  await episode.save();

  return respond.with201().body(toEpisodeDTO(episode));
};

export const episodeShow: EpisodeShow = async ({ params }, respond) => {
  const episode = await Episode.findOneOrFail({
    where: {
      mediaId: params.mediaId,
      episodeNumber: params.episodeNumber,
    },
  });

  return respond.with200().body(toEpisodeDTO(episode));
};

export const episodeUpdate: EpisodeUpdate = async ({ params, body }, respond) => {
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

export const episodeDestroy: EpisodeDestroy = async ({ params }, respond) => {
  const episode = await Episode.findOneOrFail({
    where: {
      mediaId: params.mediaId,
      episodeNumber: params.episodeNumber,
    },
  });

  await episode.softRemove();

  return respond.with204();
};
