import type {
  ListMedia,
  CreateMedia,
  GetMedia,
  UpdateMedia,
  DeleteMedia,
  AutocompleteMedia,
} from 'generated/routes/media';
import type { t_CharacterInput, t_ExternalId } from 'generated/models';
import type { EntityManager } from 'typeorm';
import { ILike } from 'typeorm';
import { CategoryType, Media, MediaCharacter, MediaExternalId, MediaInclude } from '@app/models';
import { Character } from '@app/models/Character';
import { Seiyuu } from '@app/models/Seiyuu';
import { CharacterRole } from '@app/models/MediaCharacter';
import { MEDIA_INFO_CACHE } from '@app/models/Media';
import {
  toMediaCreateAttributes,
  toMediaDTO,
  toMediaExternalIdAttributes,
  toMediaListDTO,
  toMediaUpdatePatch,
} from './mappers/media.mapper';
import { Cache } from '@lib/cache';
import { SegmentDocument } from '@app/models/SegmentDocument';

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

export const createMedia: CreateMedia = async ({ body }, respond) => {
  const media = await Media.getRepository().manager.transaction(async (manager) => {
    const media = await manager.save(Media, toMediaCreateAttributes(body));

    if (body.characters?.length) {
      media.characters = await replaceMediaCharacters(manager, media.id, body.characters);
    }

    return media;
  });

  Cache.invalidate(MEDIA_INFO_CACHE);
  Cache.invalidate(SegmentDocument.SEARCH_STATS_CACHE);

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
  const media = await Media.getRepository().manager.transaction(async (manager) => {
    const media = await manager.findOneOrFail(Media, { where: { id: params.id } });
    const patch = toMediaUpdatePatch(body);

    Media.merge(media, patch);

    if (body.externalIds !== undefined) {
      media.externalIds = await replaceMediaExternalIds(manager, media.id, body.externalIds);
    }

    if (body.characters !== undefined) {
      media.characters = await replaceMediaCharacters(manager, media.id, body.characters);
    }

    await manager.save(media);

    return manager.findOneOrFail(Media, {
      where: { id: media.id },
      relations: Media.buildRelations({
        includeCharacters: body.characters !== undefined,
      }),
    });
  });

  Cache.invalidate(MEDIA_INFO_CACHE);
  Cache.invalidate(SegmentDocument.SEARCH_STATS_CACHE);

  return respond.with200().body(toMediaDTO(media));
};

export const deleteMedia: DeleteMedia = async ({ params }, respond) => {
  await Media.softDeleteOrFail({ where: { id: params.id } });
  Cache.invalidate(MEDIA_INFO_CACHE);
  Cache.invalidate(SegmentDocument.SEARCH_STATS_CACHE);

  return respond.with204();
};

export const autocompleteMedia: AutocompleteMedia = async ({ query: params }, respond) => {
  const normalizedQuery = params.query.trim().toLowerCase();
  const escaped = escapeLikePattern(normalizedQuery);
  const containsPattern = `%${escaped}%`;
  const prefixPattern = `${escaped}%`;
  const matchRankExpression = `CASE
    WHEN LOWER(media.english_name) = :exact OR LOWER(media.japanese_name) = :exact OR LOWER(media.romaji_name) = :exact THEN 0
    WHEN LOWER(media.english_name) LIKE :prefix ESCAPE '\\' OR LOWER(media.japanese_name) LIKE :prefix ESCAPE '\\' OR LOWER(media.romaji_name) LIKE :prefix ESCAPE '\\' THEN 1
    ELSE 2
  END`;

  const qb = Media.createQueryBuilder('media')
    .leftJoinAndSelect('media.externalIds', 'externalIds')
    .leftJoinAndSelect('media.episodes', 'episodes')
    .addSelect(matchRankExpression, 'match_rank')
    .addSelect('LENGTH(media.english_name)', 'name_length')
    .where(
      `(LOWER(media.english_name) LIKE :contains ESCAPE '\\'
      OR LOWER(media.japanese_name) LIKE :contains ESCAPE '\\'
      OR LOWER(media.romaji_name) LIKE :contains ESCAPE '\\')`,
      { contains: containsPattern },
    )
    .setParameter('exact', normalizedQuery)
    .setParameter('prefix', prefixPattern)
    .orderBy('match_rank', 'ASC')
    .addOrderBy('name_length', 'ASC')
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

const escapeLikePattern = (value: string): string => value.replace(/[\\%_]/g, '\\$&');

async function replaceMediaExternalIds(
  manager: EntityManager,
  mediaId: number,
  externalIds: t_ExternalId,
): Promise<MediaExternalId[]> {
  await manager.delete(MediaExternalId, { mediaId });

  const rows = toMediaExternalIdAttributes(externalIds).map((externalId) =>
    manager.create(MediaExternalId, { mediaId, ...externalId }),
  );

  if (rows.length === 0) {
    return [];
  }

  return manager.save(MediaExternalId, rows);
}

async function replaceMediaCharacters(
  manager: EntityManager,
  mediaId: number,
  characters: t_CharacterInput[],
): Promise<MediaCharacter[]> {
  await manager.delete(MediaCharacter, { mediaId });

  if (characters.length === 0) {
    return [];
  }

  const mediaCharacters = await insertCharactersForMedia(manager, mediaId, characters);
  return manager.save(MediaCharacter, mediaCharacters);
}

async function insertCharactersForMedia(
  manager: EntityManager,
  mediaId: number,
  characters: t_CharacterInput[],
): Promise<MediaCharacter[]> {
  return Promise.all(
    characters.map(async (char) => {
      const seiyuuAnilistId = char.seiyuu.externalIds.anilist;
      let seiyuu =
        seiyuuAnilistId === undefined
          ? null
          : await manager
              .createQueryBuilder(Seiyuu, 's')
              .where(`s.external_ids->>'anilist' = :id`, { id: seiyuuAnilistId })
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

      const characterAnilistId = char.externalIds.anilist;
      let character =
        characterAnilistId === undefined
          ? null
          : await manager
              .createQueryBuilder(Character, 'c')
              .where(`c.external_ids->>'anilist' = :id`, { id: characterAnilistId })
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
