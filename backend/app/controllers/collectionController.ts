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
import { toCollectionDTO } from './mappers/collectionMapper';
import { toSearchResponseDTO } from './mappers/searchMapper';
import { SegmentDocument } from '@app/models/SegmentDocument';
import { AccessDeniedError, InvalidRequestError } from '@app/errors';
import { assertUser } from '@app/middleware/authentication';
import { resolveMediaFilterIds } from './searchFilters';

export const listCollections: ListCollections = async ({ query }, respond, req) => {
  const user = assertUser(req);

  const whereClause: Partial<Pick<Collection, 'userId' | 'visibility'>> = { userId: user.id };

  if (query.visibility === 'PUBLIC') {
    whereClause.visibility = CollectionVisibility.PUBLIC;
  } else if (query.visibility === 'PRIVATE') {
    whereClause.visibility = CollectionVisibility.PRIVATE;
  }

  const { items: collections, pagination } = await Collection.paginateWithKeyset({
    take: query.take,
    cursor: query.cursor,
    query: () => Collection.createQueryBuilder('collection').where(whereClause),
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

  const collection = await Collection.save(
    Collection.create({
      name: body.name,
      userId: user.id,
      visibility:
        body.visibility === undefined ? CollectionVisibility.PRIVATE : toCollectionVisibility(body.visibility),
    }),
  );

  return respond.with201().body(toCollectionDTO(collection));
};


export const getCollection: GetCollection = async ({ params }, respond, req) => {
  const user = assertUser(req);
  const collection = await Collection.findOneOrFail({ where: { publicId: params.collectionPublicId } });
  assertCollectionReadable(collection, user);

  const segmentCount = await CollectionSegment.count({ where: { collectionId: collection.id } });

  return respond.with200().body(toCollectionDTO(collection, segmentCount));
};


export const updateCollection: UpdateCollection = async ({ params, body }, respond, req) => {
  const user = assertUser(req);
  const collection = await Collection.findOneOrFail({ where: { publicId: params.collectionPublicId } });
  assertCollectionOwnership(collection, user);

  const patch: Partial<Pick<Collection, 'name' | 'visibility'>> = {};
  if (body.name !== undefined) patch.name = body.name;
  if (body.visibility !== undefined) patch.visibility = toCollectionVisibility(body.visibility);

  const updated = await Collection.findAndUpdateOrFail({ where: { publicId: params.collectionPublicId }, patch });

  return respond.with200().body(toCollectionDTO(updated));
};


export const deleteCollection: DeleteCollection = async ({ params }, respond, req) => {
  const user = assertUser(req);
  const collection = await Collection.findOneOrFail({ where: { publicId: params.collectionPublicId } });
  assertCollectionOwnership(collection, user);

  if (collection.type === CollectionType.ANKI_EXPORT) {
    throw new InvalidRequestError('Cannot delete the Anki Exports collection.');
  }

  await Collection.deleteOrFail({ where: { publicId: params.collectionPublicId } });

  return respond.with204();
};


export const addSegmentToCollection: AddSegmentToCollection = async ({ params, body }, respond, req) => {
  const user = assertUser(req);
  const collection = await Collection.findOneOrFail({ where: { publicId: params.collectionPublicId } });
  assertCollectionOwnership(collection, user);

  const segmentPublicId = body.segmentPublicId;
  const segment = await Segment.findOneOrFail({ where: [{ publicId: segmentPublicId }, { uuid: segmentPublicId }] });
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
  const collection = await Collection.findOneOrFail({ where: { publicId: params.collectionPublicId } });
  assertCollectionOwnership(collection, user);

  const segment = await Segment.findOneOrFail({ where: { publicId: params.segmentPublicId }, select: ['id'] });

  const item = await CollectionSegment.findOneOrFail({
    where: { collectionId: collection.id, segmentId: segment.id },
  });

  if (body.position !== undefined) item.position = body.position;
  if (body.note !== undefined) item.note = body.note ?? null;

  await item.save();

  return respond.with204();
};


export const removeSegmentFromCollection: RemoveSegmentFromCollection = async ({ params }, respond, req) => {
  const user = assertUser(req);
  const collection = await Collection.findOneOrFail({ where: { publicId: params.collectionPublicId } });
  assertCollectionOwnership(collection, user);

  const segment = await Segment.findOneOrFail({ where: { publicId: params.segmentPublicId }, select: ['id'] });

  await CollectionSegment.deleteOrFail({
    where: { collectionId: collection.id, segmentId: segment.id },
  });

  return respond.with204();
};


export const searchCollectionSegments: SearchCollectionSegments = async ({ params, body }, respond, req) => {
  const user = assertUser(req);
  const collection = await Collection.findOneOrFail({ where: { publicId: params.collectionPublicId } });
  assertCollectionReadable(collection, user);

  await resolveMediaFilterIds(body.filters);

  const segmentIds = await fetchCollectionSegmentIds(collection.id);
  const results = await SegmentDocument.searchInIds(segmentIds, body, 'strict');

  return respond.with200().body(toSearchResponseDTO(results, body.include));
};


export const getCollectionStats: GetCollectionStats = async ({ params }, respond, req) => {
  const user = assertUser(req);
  const collection = await Collection.findOneOrFail({ where: { publicId: params.collectionPublicId } });
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

  const mediaIncludes = includes.media;

  // Compute per-media stats
  const mediaMap = new Map<string, { matchCount: number; episodeHits: Record<string, number> }>();
  const categoryCountMap = new Map<CategoryOutput, number>();

  for (const seg of searchResults) {
    let entry = mediaMap.get(seg.mediaPublicId);
    if (!entry) {
      entry = { matchCount: 0, episodeHits: {} };
      mediaMap.set(seg.mediaPublicId, entry);
    }
    entry.matchCount++;
    const epKey = String(seg.episode);
    entry.episodeHits[epKey] = (entry.episodeHits[epKey] ?? 0) + 1;

    const mediaInfo = mediaIncludes[seg.mediaPublicId];
    const category = toCategory(mediaInfo?.category);
    categoryCountMap.set(category, (categoryCountMap.get(category) ?? 0) + 1);
  }

  const media = Array.from(mediaMap.entries()).map(([mediaPublicId, stats]) => ({
    mediaPublicId,
    matchCount: stats.matchCount,
    episodeHits: Object.entries(stats.episodeHits).map(([ep, hitCount]) => ({
      episode: Number(ep),
      hitCount,
    })),
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


async function fetchCollectionSegmentIds(collectionId: number): Promise<number[]> {
  const rows = await CollectionSegment.createQueryBuilder('cs')
    .select('cs.segmentId', 'segmentId')
    .where('cs.collectionId = :collectionId', { collectionId })
    .orderBy('cs.id', 'ASC')
    .getRawMany<{ segmentId: number | string }>();

  return rows.map((row) => Number(row.segmentId)).filter(Number.isFinite);
}


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
    DEFAULT_COLLECTIONS.map(({ name, type }) =>
      Collection.create({
        name,
        type,
        userId,
        visibility: CollectionVisibility.PRIVATE,
      }),
    ),
  );
};
