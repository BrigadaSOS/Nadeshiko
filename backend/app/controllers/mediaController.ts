import type {
  ListMedia,
  CreateMedia,
  GetMedia,
  UpdateMedia,
  DeleteMedia,
  AutocompleteMedia,
} from 'generated/routes/media';
import type { t_CharacterInput } from 'generated/models';
import type { DeepPartial, EntityManager } from 'typeorm';
import { ILike } from 'typeorm';
import { CategoryType, Media, MediaCharacter, MediaExternalId, ExternalSourceType, MediaInclude } from '@app/models';
import { Character } from '@app/models/Character';
import { Seiyuu } from '@app/models/Seiyuu';
import { CharacterRole } from '@app/models/MediaCharacter';
import { MEDIA_INFO_CACHE } from '@app/models/Media';
import { toMediaDTO, toMediaListDTO } from './mappers/media.mapper';
import { AppDataSource } from '@config/database';
import { Cache } from '@lib/cache';
import { SEARCH_STATS_CACHE } from '@app/services/elasticsearch';

async function insertCharactersForMedia(
  manager: EntityManager,
  mediaId: number,
  characters: t_CharacterInput[],
): Promise<MediaCharacter[]> {
  return Promise.all(
    characters.map(async (char) => {
      let seiyuu = await manager
        .createQueryBuilder(Seiyuu, 's')
        .where(`s.external_ids->>'anilist' = :id`, { id: char.seiyuu.externalIds.anilist })
        .getOne();
      if (!seiyuu) {
        seiyuu = manager.create(Seiyuu, {
          externalIds: char.seiyuu.externalIds,
          nameJapanese: char.seiyuu.nameJa,
          nameEnglish: char.seiyuu.nameEn,
          imageUrl: char.seiyuu.imageUrl,
        });
        await manager.save(seiyuu);
      }

      let character = await manager
        .createQueryBuilder(Character, 'c')
        .where(`c.external_ids->>'anilist' = :id`, { id: char.externalIds.anilist })
        .getOne();
      if (!character) {
        character = manager.create(Character, {
          externalIds: char.externalIds,
          nameJapanese: char.nameJa,
          nameEnglish: char.nameEn,
          imageUrl: char.imageUrl,
          seiyuu,
        });
        await manager.save(character);
      }

      const mc = manager.create(MediaCharacter, {
        mediaId,
        characterId: character.id,
        role: char.role as CharacterRole,
      });
      mc.character = character;
      return mc;
    }),
  );
}

export const listMedia: ListMedia = async ({ query }, respond) => {
  const base = query.category ? { category: query.category as CategoryType } : {};

  const where = query.query
    ? [
        { ...base, nameEn: ILike(`%${query.query}%`) },
        { ...base, nameJa: ILike(`%${query.query}%`) },
        { ...base, nameRomaji: ILike(`%${query.query}%`) },
      ]
    : query.category
      ? base
      : undefined;

  const mediaRelations = Media.buildRelations({
    includeCharacters: query.include?.includes(MediaInclude.MEDIA_CHARACTERS) ?? false,
  });

  const { items: mediaList, pagination } = await Media.paginateWithOffset({
    find: {
      where,
      relations: mediaRelations,
      order: { id: 'ASC' },
    },
    take: query.take,
    cursor: query.cursor,
  });

  return respond.with200().body({
    media: toMediaListDTO(mediaList),
    pagination,
  });
};

const escapeLikePattern = (value: string): string => value.replace(/[\\%_]/g, '\\$&');

export const autocompleteMedia: AutocompleteMedia = async ({ query: params }, respond) => {
  const normalizedQuery = params.query.trim().toLowerCase();
  const escaped = escapeLikePattern(normalizedQuery);
  const containsPattern = `%${escaped}%`;
  const prefixPattern = `${escaped}%`;

  const qb = Media.createQueryBuilder('media')
    .leftJoinAndSelect('media.externalIds', 'externalIds')
    .leftJoinAndSelect('media.episodes', 'episodes')
    .where(
      `(LOWER(media.nameEn) LIKE :contains ESCAPE '\\'
      OR LOWER(media.nameJa) LIKE :contains ESCAPE '\\'
      OR LOWER(media.nameRomaji) LIKE :contains ESCAPE '\\')`,
      { contains: containsPattern },
    )
    .setParameter('exact', normalizedQuery)
    .setParameter('prefix', prefixPattern)
    .orderBy(
      `CASE
        WHEN LOWER(media.nameEn) = :exact OR LOWER(media.nameJa) = :exact OR LOWER(media.nameRomaji) = :exact THEN 0
        WHEN LOWER(media.nameEn) LIKE :prefix ESCAPE '\\' OR LOWER(media.nameJa) LIKE :prefix ESCAPE '\\' OR LOWER(media.nameRomaji) LIKE :prefix ESCAPE '\\' THEN 1
        ELSE 2
      END`,
      'ASC',
    )
    .addOrderBy('LENGTH(media.nameEn)', 'ASC')
    .addOrderBy('media.id', 'ASC')
    .take(params.take);

  if (params.category) {
    qb.andWhere('media.category = :category', { category: params.category as CategoryType });
  }

  const media = await qb.getMany();
  return respond.with200().body({
    media: toMediaListDTO(media),
  });
};

export const createMedia: CreateMedia = async ({ body }, respond) => {
  const media = await AppDataSource.transaction(async (manager) => {
    const externalIds: DeepPartial<MediaExternalId>[] = [];
    if (body.externalIds) {
      const sourceMap: Record<string, ExternalSourceType> = {
        anilist: ExternalSourceType.ANILIST,
        imdb: ExternalSourceType.IMDB,
        tvdb: ExternalSourceType.TVDB,
      };
      for (const [key, value] of Object.entries(body.externalIds)) {
        if (value && sourceMap[key]) {
          externalIds.push({ source: sourceMap[key], externalId: value });
        }
      }
    }

    const media = await manager.save(Media, {
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
      storageBasePath: body.storageBasePath,
      studio: body.studio,
      seasonName: body.seasonName,
      seasonYear: body.seasonYear,
      externalIds,
    });

    if (body.characters?.length) {
      media.characters = await insertCharactersForMedia(manager, media.id, body.characters);
      await manager.save(MediaCharacter, media.characters);
    }

    return media;
  });

  Cache.invalidate(MEDIA_INFO_CACHE);
  Cache.invalidate(SEARCH_STATS_CACHE);

  return respond.with201().body(toMediaDTO(media));
};

export const getMedia: GetMedia = async ({ params, query }, respond) => {
  const mediaRelations = Media.buildRelations({
    includeCharacters: query.include?.includes(MediaInclude.MEDIA_CHARACTERS) ?? false,
  });

  const media = await Media.findOneOrFail({
    where: { id: params.id },
    relations: mediaRelations,
  });

  return respond.with200().body(toMediaDTO(media));
};

export const updateMedia: UpdateMedia = async ({ params, body }, respond) => {
  const media = await AppDataSource.transaction(async (manager) => {
    const media = await manager.findOneOrFail(Media, { where: { id: params.id } });

    // Extract only the fields we want to update (exclude relations and computed fields)
    const { characters, segmentCount: _segmentCount, ...updateFields } = body;

    Media.merge(media, updateFields as DeepPartial<Media>);

    if (characters?.length) {
      await manager.delete(MediaCharacter, { mediaId: media.id });
      media.characters = await insertCharactersForMedia(manager, media.id, characters);
      await manager.save(MediaCharacter, media.characters);
    }

    return await manager.save(media);
  });

  Cache.invalidate(MEDIA_INFO_CACHE);

  return respond.with200().body(toMediaDTO(media));
};

export const deleteMedia: DeleteMedia = async ({ params }, respond) => {
  const media = await Media.findOneOrFail({
    where: { id: params.id },
  });

  await media.softRemove();
  Cache.invalidate(MEDIA_INFO_CACHE);
  Cache.invalidate(SEARCH_STATS_CACHE);

  return respond.with204();
};
