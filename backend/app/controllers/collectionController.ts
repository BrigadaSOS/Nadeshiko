import type {
  ListCollections,
  GetCollection,
  CreateCollection,
  UpdateCollection,
  DeleteCollection,
  AddSegmentToCollection,
  UpdateCollectionSegment,
  RemoveSegmentFromCollection,
  SearchCollectionSegments,
  GetCollectionStats,
} from 'generated/routes/collections';
import {
  Collection,
  CollectionSegment,
  CollectionType,
  CollectionVisibility,
  Segment,
  UserRoleType,
} from '@app/models';
import type { CategoryOutput } from 'generated/outputTypes';
import type { User } from '@app/models/User';
import { toCollectionDTO } from './mappers/collection.mapper';
import { SegmentDocument } from '@app/models/SegmentDocument';
import { AccessDeniedError, InvalidRequestError } from '@app/errors';
import { assertUser } from '@app/middleware/authentication';

export const listCollections: ListCollections = async ({ query }, respond, req) => {
  const user = assertUser(req);

  const whereClause: Partial<Pick<Collection, 'userId' | 'visibility'>> = { userId: user.id };

  if (query.visibility === 'public') {
    whereClause.visibility = CollectionVisibility.PUBLIC;
  } else if (query.visibility === 'private') {
    whereClause.visibility = CollectionVisibility.PRIVATE;
  }

  const { items: collections, pagination } = await Collection.paginateWithOffset({
    take: query.take,
    cursor: query.cursor,
    find: {
      where: whereClause,
      order: { createdAt: 'DESC' },
    },
  });

  // Get segment counts for all fetched collections in a single query
  const collectionIds = collections.map((c) => c.id);
  const countMap = new Map<number, number>();

  if (collectionIds.length > 0) {
    const counts = await CollectionSegment.createQueryBuilder('cs')
      .select('cs.collectionId', 'collectionId')
      .addSelect('COUNT(*)', 'count')
      .where('cs.collectionId IN (:...ids)', { ids: collectionIds })
      .groupBy('cs.collectionId')
      .getRawMany<{ collectionId: number; count: string }>();

    for (const row of counts) {
      countMap.set(row.collectionId, Number(row.count));
    }
  }

  return respond.with200().body({
    collections: collections.map((c) => toCollectionDTO(c, countMap.get(c.id) ?? 0)),
    pagination,
  });
};

export const createCollection: CreateCollection = async ({ body }, respond, req) => {
  const user = assertUser(req);

  const collection = await Collection.save({
    name: body.name,
    userId: user.id,
    visibility: body.visibility === undefined ? CollectionVisibility.PRIVATE : toCollectionVisibility(body.visibility),
  });

  return respond.with201().body(toCollectionDTO(collection));
};

export const getCollection: GetCollection = async ({ params, query }, respond, req) => {
  const user = assertUser(req);
  const collection = await Collection.findOneOrFail({ where: { publicId: params.id } });
  assertCollectionReadable(collection, user);

  const {
    items: segmentItems,
    totalCount,
    pagination,
  } = await CollectionSegment.paginateWithOffset({
    take: query.take,
    cursor: query.cursor,
    findAndCount: {
      where: { collectionId: collection.id },
      order: { position: 'ASC' },
    },
  });

  if (segmentItems.length === 0) {
    return respond.with200().body({
      ...toCollectionDTO(collection, totalCount),
      segments: [],
      includes: { media: {} },
      totalCount,
      pagination,
    });
  }

  const segmentIds = segmentItems.map((item) => item.segmentId);
  const { segments: searchResults, includes } = await SegmentDocument.findByIds(segmentIds);

  const resultById = new Map(searchResults.map((r) => [r.id, r]));

  const segments = segmentItems
    .map((item) => {
      const result = resultById.get(item.segmentId);
      if (!result) return null;
      return {
        position: item.position,
        note: item.note,
        result,
      };
    })
    .filter((s): s is NonNullable<typeof s> => s !== null);

  return respond.with200().body({
    ...toCollectionDTO(collection, totalCount),
    segments,
    includes,
    totalCount,
    pagination,
  });
};

export const updateCollection: UpdateCollection = async ({ params, body }, respond, req) => {
  const user = assertUser(req);
  const collection = await Collection.findOneOrFail({ where: { publicId: params.id } });
  assertCollectionOwnership(collection, user);

  const patch: Partial<Pick<Collection, 'name' | 'visibility'>> = {};
  if (body.name !== undefined) patch.name = body.name;
  if (body.visibility !== undefined) patch.visibility = toCollectionVisibility(body.visibility);

  const updated = await Collection.findAndUpdateOrFail({ where: { publicId: params.id }, patch });

  return respond.with200().body(toCollectionDTO(updated));
};

export const deleteCollection: DeleteCollection = async ({ params }, respond, req) => {
  const user = assertUser(req);
  const collection = await Collection.findOneOrFail({ where: { publicId: params.id } });
  assertCollectionOwnership(collection, user);

  if (collection.type === CollectionType.ANKI_EXPORT) {
    throw new InvalidRequestError('Cannot delete the Anki Exports collection.');
  }

  await Collection.deleteOrFail({ where: { publicId: params.id } });

  return respond.with204();
};

export const addSegmentToCollection: AddSegmentToCollection = async ({ params, body }, respond, req) => {
  const user = assertUser(req);
  const collection = await Collection.findOneOrFail({ where: { publicId: params.id } });
  assertCollectionOwnership(collection, user);

  const segment = await Segment.findOneOrFail({ where: [{ publicId: body.segmentId }, { uuid: body.segmentId }] });
  await Collection.getRepository().manager.transaction(async (manager) => {
    await manager
      .createQueryBuilder(Collection, 'collection')
      .setLock('pessimistic_write')
      .where('collection.id = :id', { id: collection.id })
      .getOneOrFail();

    const maxPositionResult = await manager
      .createQueryBuilder(CollectionSegment, 'item')
      .select('MAX(item.position)', 'maxPos')
      .where('item.collectionId = :collectionId', { collectionId: collection.id })
      .getRawOne<{ maxPos: string | null }>();
    const nextPosition = Number(maxPositionResult?.maxPos ?? 0) + 1;

    const result = await manager
      .createQueryBuilder()
      .insert()
      .into(CollectionSegment)
      .values({
        collectionId: collection.id,
        segmentId: segment.id,
        mediaId: segment.mediaId,
        position: nextPosition,
        note: body.note ?? null,
      })
      .orIgnore()
      .execute();

    return result.identifiers.length > 0 || (result.raw?.rowCount ?? 0) > 0;
  });

  return respond.with204();
};

export const updateCollectionSegment: UpdateCollectionSegment = async ({ params, body }, respond, req) => {
  const user = assertUser(req);
  const collection = await Collection.findOneOrFail({ where: { publicId: params.id } });
  assertCollectionOwnership(collection, user);

  const item = await CollectionSegment.findOneOrFail({
    where: { collectionId: collection.id, segmentId: params.segmentId },
  });

  if (body.position !== undefined) item.position = body.position;
  if (body.note !== undefined) item.note = body.note ?? null;

  await item.save();

  return respond.with204();
};

export const removeSegmentFromCollection: RemoveSegmentFromCollection = async ({ params }, respond, req) => {
  const user = assertUser(req);
  const collection = await Collection.findOneOrFail({ where: { publicId: params.id } });
  assertCollectionOwnership(collection, user);

  await CollectionSegment.deleteOrFail({
    where: { collectionId: collection.id, segmentId: params.segmentId },
  });

  return respond.with204();
};

export const searchCollectionSegments: SearchCollectionSegments = async ({ params, query }, respond, req) => {
  const user = assertUser(req);
  const collection = await Collection.findOneOrFail({ where: { publicId: params.id } });
  assertCollectionReadable(collection, user);

  const {
    items: segmentItems,
    totalCount,
    pagination,
  } = await CollectionSegment.paginateWithOffset({
    take: query.take,
    cursor: query.cursor,
    findAndCount: {
      where: { collectionId: collection.id },
      order: { position: 'ASC' },
    },
  });

  if (segmentItems.length === 0) {
    return respond.with200().body({
      segments: [],
      includes: { media: {} },
      pagination: {
        ...pagination,
        estimatedTotalHits: totalCount,
        estimatedTotalHitsRelation: 'EXACT' as const,
      },
    });
  }

  const segmentIds = segmentItems.map((item) => item.segmentId);
  const { segments: searchResults, includes } = await SegmentDocument.findByIds(segmentIds);

  // Preserve collection ordering
  const resultById = new Map(searchResults.map((r) => [r.id, r]));
  const segments = segmentItems
    .map((item) => resultById.get(item.segmentId))
    .filter((s): s is NonNullable<typeof s> => s != null);

  return respond.with200().body({
    segments,
    includes,
    pagination: {
      ...pagination,
      estimatedTotalHits: totalCount,
      estimatedTotalHitsRelation: 'EXACT' as const,
    },
  });
};

export const getCollectionStats: GetCollectionStats = async ({ params }, respond, req) => {
  const user = assertUser(req);
  const collection = await Collection.findOneOrFail({ where: { publicId: params.id } });
  assertCollectionReadable(collection, user);

  // Fetch all segment items from the collection
  const allSegmentItems = await CollectionSegment.find({
    where: { collectionId: collection.id },
    order: { position: 'ASC' },
  });

  if (allSegmentItems.length === 0) {
    return respond.with200().body({ media: [], categories: [], includes: { media: {} } });
  }

  // Get full segment data from ES to access media info
  const segmentIds = allSegmentItems.map((item) => item.segmentId);
  const { segments: searchResults, includes } = await SegmentDocument.findByIds(segmentIds);
  const expectedIds = new Set(segmentIds);

  const mediaIncludes = includes.media;

  // Compute per-media stats
  const mediaMap = new Map<number, { matchCount: number; episodeHits: Record<string, number> }>();
  const categoryCountMap = new Map<CategoryOutput, number>();

  for (const seg of searchResults) {
    if (!expectedIds.has(seg.id)) {
      continue;
    }

    let entry = mediaMap.get(seg.mediaId);
    if (!entry) {
      entry = { matchCount: 0, episodeHits: {} };
      mediaMap.set(seg.mediaId, entry);
    }
    entry.matchCount++;
    const epKey = String(seg.episode);
    entry.episodeHits[epKey] = (entry.episodeHits[epKey] ?? 0) + 1;

    const mediaInfo = mediaIncludes[String(seg.mediaId)];
    const category = toCategory(mediaInfo?.category);
    categoryCountMap.set(category, (categoryCountMap.get(category) ?? 0) + 1);
  }

  const media = Array.from(mediaMap.entries()).map(([mediaId, stats]) => ({
    mediaId,
    publicId: mediaIncludes[String(mediaId)]?.publicId ?? '',
    matchCount: stats.matchCount,
    episodeHits: stats.episodeHits,
  }));

  const categories = Array.from(categoryCountMap.entries()).map(([category, count]) => ({
    category,
    count,
  }));

  return respond.with200().body({ media, categories, includes });
};

const isAdmin = (user: Pick<User, 'role'>): boolean => user.role === UserRoleType.ADMIN;

const assertCollectionOwnership = (collection: Collection, user: Pick<User, 'id' | 'role'>): void => {
  if (collection.userId !== user.id && !isAdmin(user)) {
    throw new AccessDeniedError('You do not have permission to modify this collection.');
  }
};

const assertCollectionReadable = (collection: Collection, user: Pick<User, 'id' | 'role'>): void => {
  if (collection.visibility === CollectionVisibility.PUBLIC) {
    return;
  }

  if (collection.userId === user.id || isAdmin(user)) {
    return;
  }

  throw new AccessDeniedError('You do not have permission to view this collection.');
};

const toCategory = (value: string | undefined): CategoryOutput => (value === 'JDRAMA' ? 'JDRAMA' : 'ANIME');

const toCollectionVisibility = (value: string): CollectionVisibility =>
  value === 'PUBLIC' ? CollectionVisibility.PUBLIC : CollectionVisibility.PRIVATE;

const DEFAULT_COLLECTIONS: { name: string; type: CollectionType }[] = [
  { name: 'Favorites', type: CollectionType.USER },
  { name: 'Anki Exports', type: CollectionType.ANKI_EXPORT },
];

export const ensureDefaultCollections = async (userId: number): Promise<void> => {
  const count = await Collection.count({ where: { userId } });
  if (count > 0) return;

  await Collection.save(
    DEFAULT_COLLECTIONS.map(({ name, type }) => ({
      name,
      type,
      userId,
      visibility: CollectionVisibility.PRIVATE,
    })),
  );
};
