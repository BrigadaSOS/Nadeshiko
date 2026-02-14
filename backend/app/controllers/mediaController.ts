import type { MediaIndex, MediaCreate, MediaShow, MediaUpdate, MediaDestroy } from 'generated/routes/media';
import type { DeepPartial } from 'typeorm';
import { CategoryType, Media, MediaCharacter, CharacterRole } from '@app/models';
import { MEDIA_INFO_CACHE } from '@app/models/Media';
import { toMediaDTO, toMediaListDTO } from './mappers/media.mapper';
import { AppDataSource } from '@config/database';
import { Cache } from '@lib/cache';
import { SEARCH_STATS_CACHE } from '@app/services/elasticsearch';

function toCharacterData(char: {
  id: number;
  nameJa?: string;
  nameEn?: string;
  imageUrl?: string;
  role: string;
  seiyuuId?: number;
  seiyuuNameJa?: string;
  seiyuuNameEn?: string;
  seiyuuImageUrl?: string;
}) {
  return {
    role: char.role as CharacterRole,
    character: {
      id: char.id,
      nameJapanese: char.nameJa,
      nameEnglish: char.nameEn,
      imageUrl: char.imageUrl,
      seiyuu: {
        id: char.seiyuuId,
        nameJapanese: char.seiyuuNameJa,
        nameEnglish: char.seiyuuNameEn,
        imageUrl: char.seiyuuImageUrl,
      },
    },
  };
}

export const mediaIndex: MediaIndex = async ({ query }, respond) => {
  const [mediaList] = await Media.findAndCount({
    where: query.category ? { category: query.category as CategoryType } : {},
    relations: {
      episodes: true,
      characters: { character: { seiyuu: true } },
      listItems: { list: true },
    },
    order: { id: 'ASC' },
    take: query.limit,
    skip: query.cursor,
  });

  const nextCursor = query.cursor + mediaList.length;
  const hasMoreResults = mediaList.length === query.limit;

  return respond.with200().body({
    data: toMediaListDTO(mediaList),
    cursor: hasMoreResults ? nextCursor : undefined,
    hasMoreResults,
  });
};

export const mediaCreate: MediaCreate = async ({ body }, respond) => {
  const media = await AppDataSource.transaction(async (manager) => {
    return await manager.save(Media, {
      id: body.anilistId,
      anilistId: body.anilistId,
      nameJa: body.nameJa,
      nameRomaji: body.nameRomaji,
      nameEn: body.nameEn,
      airingFormat: body.airingFormat,
      airingStatus: body.airingStatus,
      genres: body.genres,
      startDate: body.startDate,
      endDate: body.endDate,
      category: body.category as CategoryType,
      version: body.version,
      hashSalt: body.hashSalt,
      studio: body.studio,
      seasonName: body.seasonName,
      seasonYear: body.seasonYear,
      characters: body.characters?.map(toCharacterData),
    });
  });

  Cache.invalidate(MEDIA_INFO_CACHE);
  Cache.invalidate(SEARCH_STATS_CACHE);

  return respond.with201().body(toMediaDTO(media));
};

export const mediaShow: MediaShow = async ({ params }, respond) => {
  const media = await Media.findOneOrFail({
    where: { id: params.id },
    relations: {
      episodes: true,
      characters: { character: { seiyuu: true } },
      listItems: { list: true },
    },
  });

  return respond.with200().body(toMediaDTO(media));
};

export const mediaUpdate: MediaUpdate = async ({ params, body }, respond) => {
  const media = await AppDataSource.transaction(async (manager) => {
    const media = await manager.findOneOrFail(Media, { where: { id: params.id } });

    // Extract only the fields we want to update (exclude relations and computed fields)
    const { characters, lists: _lists, segmentCount: _segmentCount, ...updateFields } = body;

    Media.merge(media, updateFields as DeepPartial<Media>);

    if (characters?.length) {
      await manager.delete(MediaCharacter, { mediaId: media.id });
      media.characters = characters.map((char) =>
        manager.create(MediaCharacter, {
          mediaId: media.id,
          characterId: char.id,
          ...toCharacterData(char),
        }),
      );
    }

    return await manager.save(media);
  });

  Cache.invalidate(MEDIA_INFO_CACHE);

  return respond.with200().body(toMediaDTO(media));
};

export const mediaDestroy: MediaDestroy = async ({ params }, respond) => {
  const media = await Media.findOneOrFail({
    where: { id: params.id },
  });

  await media.softRemove();
  Cache.invalidate(MEDIA_INFO_CACHE);
  Cache.invalidate(SEARCH_STATS_CACHE);

  return respond.with200().body({
    message: 'Media deleted successfully',
    id: params.id,
  });
};
