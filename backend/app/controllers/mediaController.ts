import type {
  ListMedia,
  ListMediaResponder,
  CreateMedia,
  GetMedia,
  UpdateMedia,
  DeleteMedia,
  AutocompleteMedia,
} from 'generated/routes/media';
import type { ListMediaQueryOutput } from 'generated/outputTypes';
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
import { toMediaAutocompleteDTO } from './mappers/shared.mapper';
import { Cache } from '@lib/cache';
import { decodeOffsetCursor, encodeOffsetCursor } from '@lib/cursor';
import { SegmentDocument } from '@app/models/SegmentDocument';
import { InvalidRequestError } from '@app/errors';

export const listMedia: ListMedia = async ({ query }, respond) => {
  if (query.query) {
    return listMediaRanked(query, respond);
  }

  const base = query.category ? { category: query.category as CategoryType } : {};
  const where = query.category ? base : undefined;

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

async function listMediaRanked(query: ListMediaQueryOutput, respond: ListMediaResponder) {
  const normalizedQuery = query.query!.trim().toLowerCase();
  const escaped = escapeLikePattern(normalizedQuery);
  const containsPattern = `%${escaped}%`;
  const prefixPattern = `${escaped}%`;
  const matchRankExpression = `CASE
    WHEN LOWER(media.english_name) = :exact OR LOWER(media.japanese_name) = :exact OR LOWER(media.romaji_name) = :exact THEN 0
    WHEN LOWER(media.english_name) LIKE :prefix ESCAPE '\\' OR LOWER(media.japanese_name) LIKE :prefix ESCAPE '\\' OR LOWER(media.romaji_name) LIKE :prefix ESCAPE '\\' THEN 1
    ELSE 2
  END`;

  const includeCharacters = query.include?.includes(MediaInclude.MEDIA_CHARACTERS) ?? false;
  const skip = decodeOffsetCursor(query.cursor);
  const take = query.take;

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
    .skip(skip)
    .take(take + 1);

  if (query.category) {
    qb.andWhere('media.category = :category', { category: query.category as CategoryType });
  }

  if (includeCharacters) {
    qb.leftJoinAndSelect('media.characters', 'characters')
      .leftJoinAndSelect('characters.character', 'character')
      .leftJoinAndSelect('character.seiyuu', 'seiyuu');
  }

  const rows = await qb.getMany();
  const hasMore = rows.length > take;
  const mediaList = hasMore ? rows.slice(0, take) : rows;

  return respond.with200().body({
    media: toMediaListDTO(mediaList),
    pagination: {
      hasMore,
      cursor: hasMore ? encodeOffsetCursor(skip + mediaList.length) : null,
    },
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
  if (!normalizedQuery) {
    throw new InvalidRequestError('query must contain at least one non-whitespace character');
  }

  const escaped = escapeLikePattern(normalizedQuery);
  const containsPattern = `%${escaped}%`;
  const prefixPattern = `${escaped}%`;
  const matchRankExpression = `CASE
    WHEN LOWER(media.english_name) = :exact OR LOWER(media.japanese_name) = :exact OR LOWER(media.romaji_name) = :exact THEN 0
    WHEN LOWER(media.english_name) LIKE :prefix ESCAPE '\\' OR LOWER(media.japanese_name) LIKE :prefix ESCAPE '\\' OR LOWER(media.romaji_name) LIKE :prefix ESCAPE '\\' THEN 1
    ELSE 2
  END`;

  const qb = Media.createQueryBuilder('media')
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
    media: media.map(toMediaAutocompleteDTO),
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

  const result = await insertCharactersForMedia(manager, characters);
  const mediaCharacters = result.map((r) => {
    r.mediaCharacter.mediaId = mediaId;
    return r.mediaCharacter;
  });
  const saved = await manager.save(MediaCharacter, mediaCharacters);

  for (let i = 0; i < saved.length; i++) {
    saved[i].character = await manager.findOneOrFail(Character, {
      where: { id: saved[i].characterId },
      relations: ['seiyuu'],
    });
  }

  return saved;
}

async function insertCharactersForMedia(
  manager: EntityManager,
  characters: t_CharacterInput[],
): Promise<{ mediaCharacter: MediaCharacter; seiyuu: Seiyuu }[]> {
  const result: { mediaCharacter: MediaCharacter; seiyuu: Seiyuu }[] = [];

  for (const char of characters) {
    const seiyuu = await upsertSeiyuu(manager, char.seiyuu);

    const characterAnilistId = char.externalIds.anilist;
    let character: Character;

    if (characterAnilistId === undefined) {
      character = manager.create(Character, {
        externalIds: char.externalIds,
        nameJapanese: char.nameJa,
        nameEnglish: char.nameEn,
        imageUrl: char.imageUrl,
        seiyuu,
      });
      await manager.save(character);
    } else {
      const existing = await manager
        .createQueryBuilder(Character, 'c')
        .where(`c.external_ids->>'anilist' = :id`, { id: characterAnilistId })
        .getOne();

      if (existing) {
        character = existing;
      } else {
        character = manager.create(Character, {
          externalIds: char.externalIds,
          nameJapanese: char.nameJa,
          nameEnglish: char.nameEn,
          imageUrl: char.imageUrl,
          seiyuu,
        });
        await manager.save(character);
      }
    }

    result.push({
      seiyuu,
      mediaCharacter: manager.create(MediaCharacter, {
        characterId: character.id,
        role: char.role as CharacterRole,
      }),
    });
  }

  return result;
}

async function upsertSeiyuu(
  manager: EntityManager,
  seiyuuInput: t_CharacterInput['seiyuu'],
): Promise<Seiyuu> {
  const anilistId = seiyuuInput.externalIds.anilist;

  if (anilistId === undefined) {
    const seiyuu = manager.create(Seiyuu, {
      externalIds: seiyuuInput.externalIds,
      nameJapanese: seiyuuInput.nameJa,
      nameEnglish: seiyuuInput.nameEn,
      imageUrl: seiyuuInput.imageUrl,
    });
    await manager.save(seiyuu);
    return seiyuu;
  }

  const maxRetries = 3;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const existing = await manager
      .createQueryBuilder(Seiyuu, 's')
      .where(`s.external_ids->>'anilist' = :id`, { id: anilistId })
      .getOne();

    if (existing) {
      return existing;
    }

    const seiyuu = manager.create(Seiyuu, {
      externalIds: seiyuuInput.externalIds,
      nameJapanese: seiyuuInput.nameJa,
      nameEnglish: seiyuuInput.nameEn,
      imageUrl: seiyuuInput.imageUrl,
    });

    try {
      await manager.save(seiyuu);
      return seiyuu;
    } catch (error: unknown) {
      if (
        attempt < maxRetries - 1 &&
        isDuplicateKeyError(error)
      ) {
        continue;
      }
      throw error;
    }
  }

  throw new Error('Failed to upsert seiyuu after retries');
}

function isDuplicateKeyError(error: unknown): boolean {
  if (error instanceof Error) {
    const errMsg = error.message;
    return (
      errMsg.includes('duplicate key') ||
      errMsg.includes('unique constraint') ||
      errMsg.includes('IDX_Seiyuu_anilist_id')
    );
  }
  return false;
}
