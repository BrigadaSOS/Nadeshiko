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
import type { DeepPartial } from 'typeorm';
import { CategoryType, Media, MediaCharacter, MediaExternalId, MediaInclude, Segment } from '@app/models';
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
import { SegmentIndexer } from '@app/models/segmentDocument/SegmentIndexer';
import { InvalidRequestError } from '@app/errors';
import { slugify, hasJapaneseChars } from '@lib/utils/slug';

export const listMedia: ListMedia = async ({ query }, respond) => {
  if (query.query) {
    return listMediaRanked(query, respond);
  }

  const base = query.category ? { category: query.category as CategoryType } : {};
  const where = query.category ? base : undefined;

  const mediaRelations = Media.buildRelations({
    includeCharacters: query.include?.includes(MediaInclude.MEDIA_CHARACTERS) ?? false,
  });

  const [{ items: mediaList, pagination }, globalStats] = await Promise.all([
    Media.paginateWithOffset({
      find: {
        where,
        relations: mediaRelations,
        order: { id: 'DESC' },
      },
      take: query.take,
      cursor: query.cursor,
    }),
    Media.getGlobalStats(),
  ]);

  return respond.with200().body({
    media: toMediaListDTO(mediaList),
    pagination,
    stats: {
      totalMedia: globalStats.fullTotalAnimes,
      totalSegments: globalStats.fullTotalSegments,
      totalEpisodes: globalStats.fullTotalEpisodes,
    },
  });
};

async function listMediaRanked(query: ListMediaQueryOutput, respond: ListMediaResponder) {
  const normalizedQuery = (query.query ?? '').trim().toLowerCase();
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

  const [rows, globalStats] = await Promise.all([qb.getMany(), Media.getGlobalStats()]);
  const hasMore = rows.length > take;
  const mediaList = hasMore ? rows.slice(0, take) : rows;

  return respond.with200().body({
    media: toMediaListDTO(mediaList),
    pagination: {
      hasMore,
      cursor: hasMore ? encodeOffsetCursor(skip + mediaList.length) : null,
    },
    stats: {
      totalMedia: globalStats.fullTotalAnimes,
      totalSegments: globalStats.fullTotalSegments,
      totalEpisodes: globalStats.fullTotalEpisodes,
    },
  });
}

export const createMedia: CreateMedia = async ({ body }, respond) => {
  const attrs = toMediaCreateAttributes(body);
  const romajiName = String(attrs.nameRomaji || '');
  const slugSource = romajiName && !hasJapaneseChars(romajiName) ? romajiName : String(attrs.nameEn || '');
  const slug = await resolveUniqueSlug(slugSource);
  const media = await Media.create({ ...attrs, slug } as DeepPartial<Media>).save();

  if (body.characters?.length) {
    media.characters = await replaceMediaCharacters(media.id, body.characters);
  }

  Cache.invalidate(MEDIA_INFO_CACHE);
  Cache.invalidate(SegmentDocument.SEARCH_STATS_CACHE);

  return respond.with201().body(toMediaDTO(media));
};

export const getMedia: GetMedia = async ({ params, query }, respond) => {
  const mediaRelations = Media.buildRelations({
    includeCharacters: query.include?.includes(MediaInclude.MEDIA_CHARACTERS) ?? false,
  });

  const media = await Media.findOneOrFail({
    where: [{ publicId: params.id }, { slug: params.id }],
    relations: mediaRelations,
  });

  return respond.with200().body(toMediaDTO(media));
};

export const updateMedia: UpdateMedia = async ({ params, body }, respond) => {
  const media = await Media.findOneOrFail({ where: { publicId: params.id } });
  const patch = toMediaUpdatePatch(body);

  if (body.nameRomaji !== undefined || body.nameEn !== undefined) {
    const romaji = body.nameRomaji ?? media.nameRomaji;
    const slugSource = romaji && !hasJapaneseChars(romaji) ? romaji : (body.nameEn ?? media.nameEn);
    patch.slug = await resolveUniqueSlug(slugSource, media.id);
  }

  Media.merge(media, patch);

  if (body.externalIds !== undefined) {
    media.externalIds = await replaceMediaExternalIds(media.id, body.externalIds);
  }

  if (body.characters !== undefined) {
    media.characters = await replaceMediaCharacters(media.id, body.characters);
  }

  await media.save();

  const updated = await Media.findOneOrFail({
    where: { id: media.id },
    relations: Media.buildRelations({
      includeCharacters: body.characters !== undefined,
    }),
  });

  Cache.invalidate(MEDIA_INFO_CACHE);
  Cache.invalidate(SegmentDocument.SEARCH_STATS_CACHE);

  return respond.with200().body(toMediaDTO(updated));
};

export const deleteMedia: DeleteMedia = async ({ params }, respond) => {
  const media = await Media.findOneOrFail({ where: { publicId: params.id } });

  const segmentIds = await Segment.createQueryBuilder('s')
    .select('s.id')
    .where('s.mediaId = :mediaId', { mediaId: media.id })
    .getMany()
    .then((rows) => rows.map((r) => r.id));

  await Media.deleteOrFail({ where: { id: media.id } });

  if (segmentIds.length > 0) {
    await SegmentIndexer.bulkDelete(segmentIds);
  }

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

async function resolveUniqueSlug(name: string, excludeMediaId?: number): Promise<string> {
  const baseSlug = slugify(name);

  const qb = Media.createQueryBuilder('media')
    .select('media.slug')
    .where('media.slug = :exact OR media.slug ~ :pattern', {
      exact: baseSlug,
      pattern: `^${baseSlug}-\\d+$`,
    });

  if (excludeMediaId !== undefined) {
    qb.andWhere('media.id != :id', { id: excludeMediaId });
  }

  const existing = await qb.getMany();
  const slugSet = new Set(existing.map((m) => m.slug));

  if (!slugSet.has(baseSlug)) return baseSlug;

  let counter = 2;
  while (slugSet.has(`${baseSlug}-${counter}`)) counter++;
  return `${baseSlug}-${counter}`;
}

async function replaceMediaExternalIds(mediaId: number, externalIds: t_ExternalId): Promise<MediaExternalId[]> {
  await MediaExternalId.delete({ mediaId });

  const rows = toMediaExternalIdAttributes(externalIds).map((externalId) =>
    MediaExternalId.create({ mediaId, ...externalId }),
  );

  if (rows.length === 0) {
    return [];
  }

  return MediaExternalId.save(rows);
}

async function replaceMediaCharacters(mediaId: number, characters: t_CharacterInput[]): Promise<MediaCharacter[]> {
  await MediaCharacter.delete({ mediaId });

  if (characters.length === 0) {
    return [];
  }

  const result = await insertCharactersForMedia(characters);
  const mediaCharacters = result.map((r) => {
    r.mediaCharacter.mediaId = mediaId;
    return r.mediaCharacter;
  });
  const saved = await MediaCharacter.save(mediaCharacters);

  for (let i = 0; i < saved.length; i++) {
    saved[i].character = await Character.findOneOrFail({
      where: { id: saved[i].characterId },
      relations: ['seiyuu'],
    });
  }

  return saved;
}

async function insertCharactersForMedia(
  characters: t_CharacterInput[],
): Promise<{ mediaCharacter: MediaCharacter; seiyuu: Seiyuu }[]> {
  const result: { mediaCharacter: MediaCharacter; seiyuu: Seiyuu }[] = [];

  for (const char of characters) {
    const seiyuu = await upsertSeiyuu(char.seiyuu);

    const characterAnilistId = char.externalIds.anilist;
    let character: Character;

    if (characterAnilistId === undefined) {
      character = await Character.create({
        externalIds: char.externalIds,
        nameJapanese: char.nameJa,
        nameEnglish: char.nameEn,
        imageUrl: char.imageUrl,
        seiyuu,
      }).save();
    } else {
      const existing = await Character.createQueryBuilder('c')
        .where(`c.external_ids->>'anilist' = :id`, { id: characterAnilistId })
        .getOne();

      if (existing) {
        character = existing;
      } else {
        character = await Character.create({
          externalIds: char.externalIds,
          nameJapanese: char.nameJa,
          nameEnglish: char.nameEn,
          imageUrl: char.imageUrl,
          seiyuu,
        }).save();
      }
    }

    result.push({
      seiyuu,
      mediaCharacter: MediaCharacter.create({
        characterId: character.id,
        role: char.role as CharacterRole,
      }),
    });
  }

  return result;
}

async function upsertSeiyuu(seiyuuInput: t_CharacterInput['seiyuu']): Promise<Seiyuu> {
  const anilistId = seiyuuInput.externalIds.anilist;

  if (anilistId === undefined) {
    return Seiyuu.create({
      externalIds: seiyuuInput.externalIds,
      nameJapanese: seiyuuInput.nameJa,
      nameEnglish: seiyuuInput.nameEn,
      imageUrl: seiyuuInput.imageUrl,
    }).save();
  }

  const maxRetries = 3;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const existing = await Seiyuu.createQueryBuilder('s')
      .where(`s.external_ids->>'anilist' = :id`, { id: anilistId })
      .getOne();

    if (existing) {
      return existing;
    }

    try {
      return await Seiyuu.create({
        externalIds: seiyuuInput.externalIds,
        nameJapanese: seiyuuInput.nameJa,
        nameEnglish: seiyuuInput.nameEn,
        imageUrl: seiyuuInput.imageUrl,
      }).save();
    } catch (error: unknown) {
      if (attempt < maxRetries - 1 && isDuplicateKeyError(error)) {
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
