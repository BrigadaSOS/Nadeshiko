import type {
  ListMedia,
  ListMediaResponder,
  CreateMedia,
  GetMedia,
  UpdateMedia,
  DeleteMedia,
} from 'generated/routes/media';
import type { SearchMedia } from 'generated/routes/search';
import type { ListMediaQueryOutput } from 'generated/outputTypes';
import type { t_ExternalId } from 'generated/models';
import type { DeepPartial } from 'typeorm';
import { CategoryType, Media, MediaExternalId, Segment } from '@app/models';
import { MEDIA_INFO_CACHE } from '@app/models/Media';
import {
  toMediaCreateAttributes,
  toMediaDTO,
  toMediaExternalIdAttributes,
  toMediaListDTO,
  toMediaUpdatePatch,
} from './mappers/mediaMapper';
import { toMediaSummaryDTO } from './mappers/sharedMapper';
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

  const [{ items: mediaList, pagination }, globalStats] = await Promise.all([
    Media.paginateWithKeyset({
      take: query.take,
      cursor: query.cursor,
      query: () => {
        const qb = Media.createQueryBuilder('media')
          .leftJoinAndSelect('media.externalIds', 'externalIds')
          .leftJoinAndSelect('media.episodes', 'episodes');
        if (query.category) qb.where({ category: query.category as CategoryType });
        return qb;
      },
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

  Cache.invalidate(MEDIA_INFO_CACHE);
  Cache.invalidate(SegmentDocument.SEARCH_STATS_CACHE);

  return respond.with201().body(toMediaDTO(media) as any);
};


export const getMedia: GetMedia = async ({ params }, respond) => {
  const media = await Media.findOneOrFail({
    where: { publicId: params.mediaPublicId },
    relations: Media.buildRelations(),
  });

  return respond.with200().body(toMediaDTO(media) as any);
};


export const updateMedia: UpdateMedia = async ({ params, body }, respond) => {
  const media = await Media.findOneOrFail({ where: { publicId: params.mediaPublicId } });
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

  await media.save();

  const updated = await Media.findOneOrFail({
    where: { id: media.id },
    relations: Media.buildRelations(),
  });

  Cache.invalidate(MEDIA_INFO_CACHE);
  Cache.invalidate(SegmentDocument.SEARCH_STATS_CACHE);

  return respond.with200().body(toMediaDTO(updated) as any);
};


export const deleteMedia: DeleteMedia = async ({ params }, respond) => {
  const media = await Media.findOneOrFail({ where: { publicId: params.mediaPublicId } });

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


export const searchMedia: SearchMedia = async ({ body }, respond) => {
  const normalizedQuery = body.query.trim().toLowerCase();
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
    .take(body.take);

  const categories = body.filters?.category;
  if (categories && categories.length > 0) {
    qb.andWhere('media.category IN (:...categories)', { categories: categories as CategoryType[] });
  }

  const media = await qb.getMany();
  return respond.with200().body({
    media: media.map(toMediaSummaryDTO),
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
