import type { MediaIndex, MediaCreate, MediaShow, MediaUpdate, MediaDestroy } from 'generated/routes/media';
import type { DeepPartial } from 'typeorm';
import { CategoryType, Media, MediaCharacter, CharacterRole } from '@app/entities';
import { toMediaDTO, toMediaListDTO } from './mappers/media.mapper';
import { AppDataSource } from '@config/database';

export const mediaIndex: MediaIndex = async ({ query }, respond) => {
  const [mediaList, count] = await Media.findAndCount({
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

  const nextCursor = query.cursor + count;
  const hasMoreResults = nextCursor < count;

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
      japaneseName: body.japaneseName,
      romajiName: body.romajiName,
      englishName: body.englishName,
      airingFormat: body.airingFormat,
      airingStatus: body.airingStatus,
      genres: body.genres,
      coverUrl: body.coverUrl,
      bannerUrl: body.bannerUrl,
      startDate: new Date(body.startDate),
      endDate: body.endDate ? new Date(body.endDate) : undefined,
      category: body.category as CategoryType,
      version: body.version,
      hashSalt: body.hashSalt,
      studio: body.studio,
      seasonName: body.seasonName,
      seasonYear: body.seasonYear,
      characters: body.characters?.map((char) => ({
        role: char.characterRole as CharacterRole,
        character: {
          id: char.characterId,
          nameJapanese: char.characterNameJapanese,
          nameEnglish: char.characterNameEnglish,
          imageUrl: char.characterImageUrl,
          seiyuu: {
            id: char.seiyuuId,
            nameJapanese: char.seiyuuNameJapanese,
            nameEnglish: char.seiyuuNameEnglish,
            imageUrl: char.seiyuuImageUrl,
          },
        },
      })),
    });
  });

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

    const updateData: DeepPartial<Media> = {
      ...body,
      startDate: new Date(body.startDate as string),
      endDate: body.endDate ? new Date(body.endDate as string) : undefined,
    };
    Media.merge(media, updateData);

    if (body.characters?.length) {
      await manager.delete(MediaCharacter, { mediaId: media.id });
      media.characters = body.characters.map((char) =>
        manager.create(MediaCharacter, {
          mediaId: media.id,
          characterId: char.characterId,
          role: char.characterRole as CharacterRole,
          character: {
            id: char.characterId,
            nameJapanese: char.characterNameJapanese,
            nameEnglish: char.characterNameEnglish,
            imageUrl: char.characterImageUrl,
            seiyuu: {
              id: char.seiyuuId,
              nameJapanese: char.seiyuuNameJapanese,
              nameEnglish: char.seiyuuNameEnglish,
              imageUrl: char.seiyuuImageUrl,
            },
          },
        }),
      );
    }

    return await manager.save(media);
  });

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
