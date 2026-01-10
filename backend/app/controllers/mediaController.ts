import type { MediaIndex, MediaCreate, MediaShow, MediaUpdate, MediaDestroy } from 'generated/routes/media';
import type { DeepPartial } from 'typeorm';
import { CategoryType, Media } from '@app/entities';
import { toMediaDTO, toMediaListDTO } from './mappers/media.mapper';

export const mediaIndex: MediaIndex = async ({ query }, respond) => {
  const [mediaList, count] = await Media.findAndCount({
    where: query.category ? { category: query.category as CategoryType } : {},
    relations: { episodes: true },
    order: { id: 'ASC' },
    take: query.limit,
    skip: query.cursor,
  });

  const nextCursor = query.cursor + count;
  const hasMoreResults = nextCursor < count;

  return respond.with200().body({
    data: toMediaListDTO(mediaList),
    cursor: hasMoreResults ? nextCursor : undefined,
    hasMoreResults,
  });
};

export const mediaCreate: MediaCreate = async ({ body }, respond) => {
  const media = Media.create({
    id: body.anilistId,
    anilistId: body.anilistId,
    japaneseName: body.japaneseName,
    romajiName: body.romajiName,
    englishName: body.englishName,
    airingFormat: body.airingFormat,
    airingStatus: body.airingStatus,
    genres: body.genres,
    coverUrl: body.coverUrl,
    bannerUrl: body.bannerUrl,
    releaseDate: body.releaseDate,
    category: body.category as CategoryType,
    version: body.version,
    hashSalt: body.hashSalt,
  });

  await media.save();

  return respond.with201().body(toMediaDTO(media));
};

export const mediaShow: MediaShow = async ({ params }, respond) => {
  const media = await Media.findOneOrFail({
    where: { id: params.id },
    relations: { episodes: true },
  });

  return respond.with200().body(toMediaDTO(media));
};

export const mediaUpdate: MediaUpdate = async ({ params, body }, respond) => {
  const media = await Media.findOneOrFail({
    where: { id: params.id },
    relations: { episodes: true },
  });

  Media.merge(media, body as DeepPartial<Media>);
  await media.save();

  return respond.with200().body(toMediaDTO(media));
};

export const mediaDestroy: MediaDestroy = async ({ params }, respond) => {
  const media = await Media.findOneOrFail({
    where: { id: params.id },
  });

  await media.softRemove();

  return respond.with200().body({
    message: 'Media deleted successfully',
    id: params.id,
  });
};
