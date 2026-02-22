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
import { Collection, CollectionSegment, CollectionVisibility, Segment, UserRoleType } from '@app/models';
import { toCollectionDTO } from './mappers/collection.mapper';
import { querySegmentsByUuids } from '@app/services/elasticsearch';
import { AccessDeniedError } from '@app/errors';
import { trackActivity } from '@app/services/activityService';
import { ActivityType } from '@app/models/UserActivity';
import type { Request } from 'express';

const DEFAULT_ANKI_EXPORTS_COLLECTION = 'Anki Exports';

const isAdmin = (req: Request): boolean => req.user?.role === UserRoleType.ADMIN;

const assertCollectionOwnership = (collection: Collection, req: Request): void => {
  if (collection.userId !== req.user?.id && !isAdmin(req)) {
    throw new AccessDeniedError('You do not have permission to modify this collection.');
  }
};

const ensureDefaultAnkiExportsCollection = async (userId: number): Promise<void> => {
  const existing = await Collection.findOne({
    where: { userId, name: DEFAULT_ANKI_EXPORTS_COLLECTION },
  });
  if (existing) return;

  await Collection.save({
    name: DEFAULT_ANKI_EXPORTS_COLLECTION,
    userId,
    visibility: CollectionVisibility.PRIVATE,
  });
};

export const listCollections: ListCollections = async ({ query }, respond, req) => {
  const userId = req.user?.id;
  if (!userId) {
    throw new AccessDeniedError('Authentication required to view collections.');
  }

  await ensureDefaultAnkiExportsCollection(userId);

  const whereClause: any = { userId };

  if (query.visibility === 'public') {
    whereClause.visibility = CollectionVisibility.PUBLIC;
  } else if (query.visibility === 'private') {
    whereClause.visibility = CollectionVisibility.PRIVATE;
  }

  const { items: collections, pagination } = await Collection.paginateWithOffset({
    take: Math.min(query.take || 20, 100),
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

export const getCollection: GetCollection = async ({ params, query }, respond) => {
  const collection = await Collection.findOneOrFail({ where: { id: params.id } });

  const {
    items: segmentItems,
    totalCount,
    pagination,
  } = await CollectionSegment.paginateWithOffset({
    take: Math.min(query.take || 20, 100),
    cursor: query.cursor,
    findAndCount: {
      where: { collectionId: collection.id },
      order: { position: 'ASC' },
    },
  });

  if (segmentItems.length === 0) {
    return respond.with200().body({
      ...toCollectionDTO(collection),
      segments: [],
      totalCount,
      pagination,
    });
  }

  const uuids = segmentItems.map((item) => item.segmentUuid);
  const { segments: searchResults, includes } = await querySegmentsByUuids(uuids);

  const resultByUuid = new Map(searchResults.map((r) => [r.uuid, r]));

  const segments = segmentItems
    .map((item) => {
      const result = resultByUuid.get(item.segmentUuid);
      if (!result) return null;
      return {
        position: item.position,
        note: item.note,
        result,
      };
    })
    .filter((s): s is NonNullable<typeof s> => s !== null);

  return respond.with200().body({
    ...toCollectionDTO(collection),
    segments,
    includes,
    totalCount,
    pagination,
  });
};

export const createCollection: CreateCollection = async ({ body }, respond, req) => {
  const userId = req.user?.id;
  if (!userId) {
    throw new AccessDeniedError('Authentication required to create collections.');
  }

  const collection = await Collection.save({
    name: body.name,
    userId,
    visibility: (body.visibility as CollectionVisibility) || CollectionVisibility.PRIVATE,
  });

  return respond.with201().body(toCollectionDTO(collection));
};

export const updateCollection: UpdateCollection = async ({ params, body }, respond, req) => {
  const collection = await Collection.findOneOrFail({ where: { id: params.id } });
  assertCollectionOwnership(collection, req);

  if (body.name) collection.name = body.name;
  if (body.visibility) collection.visibility = body.visibility as CollectionVisibility;

  await collection.save();

  return respond.with200().body(toCollectionDTO(collection));
};

export const deleteCollection: DeleteCollection = async ({ params }, respond, req) => {
  const collection = await Collection.findOneOrFail({ where: { id: params.id } });
  assertCollectionOwnership(collection, req);

  await Collection.delete({ id: params.id });

  return respond.with204();
};

export const addSegmentToCollection: AddSegmentToCollection = async ({ params, body }, respond, req) => {
  const collection = await Collection.findOneOrFail({ where: { id: params.id } });
  assertCollectionOwnership(collection, req);

  const segment = await Segment.findOneOrFail({ where: { uuid: body.segmentUuid } });

  const existing = await CollectionSegment.findOne({
    where: { collectionId: collection.id, segmentUuid: body.segmentUuid },
  });
  if (existing) {
    return respond.with204();
  }

  const maxPositionResult = await CollectionSegment.createQueryBuilder('item')
    .select('MAX(item.position)', 'maxPos')
    .where('item.collectionId = :collectionId', { collectionId: collection.id })
    .getRawOne();

  const nextPosition = (maxPositionResult?.maxPos || 0) + 1;

  await CollectionSegment.save({
    collectionId: collection.id,
    segmentUuid: body.segmentUuid,
    mediaId: segment.mediaId,
    position: nextPosition,
    note: body.note || null,
  });

  if (req.user) {
    trackActivity(req.user, ActivityType.LIST_ADD_SEGMENT, {
      segmentUuid: body.segmentUuid,
      mediaId: segment.mediaId,
    }).catch(() => {});
  }

  return respond.with204();
};

export const updateCollectionSegment: UpdateCollectionSegment = async ({ params, body }, respond, req) => {
  const collection = await Collection.findOneOrFail({ where: { id: params.id } });
  assertCollectionOwnership(collection, req);

  const item = await CollectionSegment.findOneOrFail({
    where: { collectionId: params.id, segmentUuid: params.uuid },
  });

  if (body.position !== undefined) item.position = body.position;
  if (body.note !== undefined) item.note = body.note ?? null;

  await item.save();

  return respond.with204();
};

export const removeSegmentFromCollection: RemoveSegmentFromCollection = async ({ params }, respond, req) => {
  const collection = await Collection.findOneOrFail({ where: { id: params.id } });
  assertCollectionOwnership(collection, req);

  await CollectionSegment.delete({
    collectionId: params.id,
    segmentUuid: params.uuid,
  });

  return respond.with204();
};

export const searchCollectionSegments: SearchCollectionSegments = async ({ params, query }, respond) => {
  const collection = await Collection.findOneOrFail({ where: { id: params.id } });

  const {
    items: segmentItems,
    totalCount,
    pagination,
  } = await CollectionSegment.paginateWithOffset({
    take: Math.min(query.take || 20, 100),
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

  const uuids = segmentItems.map((item) => item.segmentUuid);
  const { segments: searchResults, includes } = await querySegmentsByUuids(uuids);

  // Preserve collection ordering
  const resultByUuid = new Map(searchResults.map((r) => [r.uuid, r]));
  const segments = segmentItems
    .map((item) => resultByUuid.get(item.segmentUuid))
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

export const getCollectionStats: GetCollectionStats = async ({ params }, respond) => {
  const collection = await Collection.findOneOrFail({ where: { id: params.id } });

  // Fetch all segment items from the collection
  const allSegmentItems = await CollectionSegment.find({
    where: { collectionId: collection.id },
    order: { position: 'ASC' },
  });

  if (allSegmentItems.length === 0) {
    return respond.with200().body({ media: [], categories: [] });
  }

  // Get full segment data from ES to access media info
  const uuids = allSegmentItems.map((item) => item.segmentUuid);
  const { segments: searchResults, includes } = await querySegmentsByUuids(uuids);

  const mediaIncludes = includes.media;

  // Compute per-media stats
  const mediaMap = new Map<number, { matchCount: number; episodeHits: Record<string, number> }>();
  const categoryCountMap = new Map<string, number>();

  for (const seg of searchResults) {
    let entry = mediaMap.get(seg.mediaId);
    if (!entry) {
      entry = { matchCount: 0, episodeHits: {} };
      mediaMap.set(seg.mediaId, entry);
    }
    entry.matchCount++;
    const epKey = String(seg.episode);
    entry.episodeHits[epKey] = (entry.episodeHits[epKey] ?? 0) + 1;

    const mediaInfo = mediaIncludes[String(seg.mediaId)];
    const category = (mediaInfo as any)?.category ?? 'ANIME';
    categoryCountMap.set(category, (categoryCountMap.get(category) ?? 0) + 1);
  }

  const media = Array.from(mediaMap.entries()).map(([mediaId, stats]) => ({
    mediaId,
    matchCount: stats.matchCount,
    episodeHits: stats.episodeHits,
  }));

  const categories = Array.from(categoryCountMap.entries()).map(([category, count]) => ({
    category: category as any,
    count,
  }));

  return respond.with200().body({ media, categories, includes });
};
