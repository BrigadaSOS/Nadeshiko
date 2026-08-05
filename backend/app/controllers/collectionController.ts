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
  ALL_CATEGORIES,
  CategoryType,
  Collection,
  CollectionSegment,
  CollectionType,
  CollectionVisibility,
  Media,
  Segment,
  UserRoleType,
} from '@app/models';
import type { CategoryOutput, MediaOutput } from 'generated/outputTypes';
import type { User } from '@app/models/User';
import { toCollectionDTO } from './mappers/collectionMapper';
import { toSearchResponseDTO } from './mappers/searchMapper';
import { SegmentDocument } from '@app/services/search/SegmentDocument';
import { SegmentResponse } from '@app/services/search/segmentDocument/SegmentResponse';
import { AccessDeniedError, InvalidRequestError } from '@app/errors';
import { assertUser } from '@app/middleware/authentication';
import { resolveMediaFilterIds } from './searchFilters';
import type { Request } from 'express';

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
  const collection = await loadReadableCollection(req, params.collectionPublicId);

  const segmentCount = await CollectionSegment.count({ where: { collectionId: collection.id } });

  return respond.with200().body(toCollectionDTO(collection, segmentCount));
};

export const updateCollection: UpdateCollection = async ({ params, body }, respond, req) => {
  // Loaded purely to authorize; the patch below re-reads the row it updates.
  await loadOwnedCollection(req, params.collectionPublicId);

  const patch: Partial<Pick<Collection, 'name' | 'visibility'>> = {};
  if (body.name !== undefined) patch.name = body.name;
  if (body.visibility !== undefined) patch.visibility = toCollectionVisibility(body.visibility);

  const updated = await Collection.findAndUpdateOrFail({ where: { publicId: params.collectionPublicId }, patch });

  return respond.with200().body(toCollectionDTO(updated));
};

export const deleteCollection: DeleteCollection = async ({ params }, respond, req) => {
  const collection = await loadOwnedCollection(req, params.collectionPublicId);

  if (collection.type === CollectionType.ANKI_EXPORT) {
    throw new InvalidRequestError('Cannot delete the Anki Exports collection.');
  }

  await Collection.deleteOrFail({ where: { publicId: params.collectionPublicId } });

  return respond.with204();
};

export const addSegmentToCollection: AddSegmentToCollection = async ({ params, body }, respond, req) => {
  const collection = await loadOwnedCollection(req, params.collectionPublicId);

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
      })
      .orIgnore()
      .execute();

    return result.identifiers.length > 0 || (result.raw?.rowCount ?? 0) > 0;
  });

  return respond.with204();
};

export const updateCollectionSegment: UpdateCollectionSegment = async ({ params, body }, respond, req) => {
  const collection = await loadOwnedCollection(req, params.collectionPublicId);

  const segment = await Segment.findOneOrFail({ where: { publicId: params.segmentPublicId }, select: ['id'] });

  const item = await CollectionSegment.findOneOrFail({
    where: { collectionId: collection.id, segmentId: segment.id },
  });

  if (body.position !== undefined) item.position = body.position;

  await item.save();

  return respond.with204();
};

export const removeSegmentFromCollection: RemoveSegmentFromCollection = async ({ params }, respond, req) => {
  const collection = await loadOwnedCollection(req, params.collectionPublicId);

  const segment = await Segment.findOneOrFail({ where: { publicId: params.segmentPublicId }, select: ['id'] });

  await CollectionSegment.deleteOrFail({
    where: { collectionId: collection.id, segmentId: segment.id },
  });

  return respond.with204();
};

export const searchCollectionSegments: SearchCollectionSegments = async ({ params, body }, respond, req) => {
  const collection = await loadReadableCollection(req, params.collectionPublicId);

  const filters = await resolveMediaFilterIds(body.filters);

  const segmentIds = await fetchCollectionSegmentIds(collection.id);
  const results = await SegmentDocument.searchInIds(segmentIds, { ...body, filters }, 'strict');

  return respond.with200().body(toSearchResponseDTO(results, body.include));
};

export const getCollectionStats: GetCollectionStats = async ({ params }, respond, req) => {
  const collection = await loadReadableCollection(req, params.collectionPublicId);

  // One grouped count instead of paging every row of the collection into memory and replaying
  // it through Elasticsearch a thousand ids at a time. The row count here is the number of
  // distinct (media, episode) pairs the collection touches, which the corpus bounds, so the
  // work no longer grows with the size of the collection.
  const rows = await CollectionSegment.createQueryBuilder('cs')
    .innerJoin(Segment, 'segment', 'segment.id = cs.segmentId')
    .select('segment.mediaId', 'mediaId')
    .addSelect('segment.episode', 'episode')
    .addSelect('COUNT(*)', 'hitCount')
    .where('cs.collectionId = :collectionId', { collectionId: collection.id })
    .groupBy('segment.mediaId')
    .addGroupBy('segment.episode')
    .orderBy('segment.mediaId', 'ASC')
    .addOrderBy('segment.episode', 'ASC')
    .getRawMany<{ mediaId: number | string; episode: number | string; hitCount: string }>();

  if (rows.length === 0) {
    return respond.with200().body({ media: [], categories: [], includes: { media: {} } });
  }

  const { results: mediaInfo } = await Media.getMediaInfoMap();

  const mediaMap = new Map<string, { matchCount: number; episodeHits: { episode: number; hitCount: number }[] }>();
  const categoryCountMap = new Map<CategoryOutput, number>();
  const includedMedia: Record<string, MediaOutput> = {};

  for (const row of rows) {
    const info = mediaInfo.get(Number(row.mediaId));
    // A collection can outlive the media it points at; there is nothing to report it under.
    if (!info) continue;

    const hitCount = Number(row.hitCount);
    let entry = mediaMap.get(info.publicId);
    if (!entry) {
      entry = { matchCount: 0, episodeHits: [] };
      mediaMap.set(info.publicId, entry);
      includedMedia[info.publicId] = SegmentResponse.buildMedia(info);
    }
    entry.matchCount += hitCount;
    entry.episodeHits.push({ episode: Number(row.episode), hitCount });

    const category = toCategory(info.category);
    categoryCountMap.set(category, (categoryCountMap.get(category) ?? 0) + hitCount);
  }

  const media = Array.from(mediaMap.entries()).map(([mediaPublicId, stats]) => ({
    mediaPublicId,
    matchCount: stats.matchCount,
    episodeHits: stats.episodeHits,
  }));

  // Collection stats apply no hidden-media exclusion, so `realCount` equals `count` by definition.
  const categories = Array.from(categoryCountMap.entries()).map(([category, count]) => ({
    category,
    count,
    realCount: count,
  }));

  return respond.with200().body({ media, categories, includes: { media: includedMedia } });
};

const isAdmin = (user: Pick<User, 'role'>): boolean => user.role === UserRoleType.ADMIN;

/**
 * Loads a collection the caller is allowed to *modify*, or throws.
 *
 * Fetching and authorizing are one step on purpose: every mutating handler needs
 * both, and splitting them makes "forgot the check" a silent hole rather than a
 * compile error.
 */
async function loadOwnedCollection(req: Request, collectionPublicId: string): Promise<Collection> {
  const user = assertUser(req);
  const collection = await Collection.findOneOrFail({ where: { publicId: collectionPublicId } });

  if (collection.userId !== user.id && !isAdmin(user)) {
    throw new AccessDeniedError('You do not have permission to modify this collection.');
  }

  return collection;
}

/**
 * Every id in the collection travels to Elasticsearch on every page of a collection search,
 * because restricting the result set is what makes it a collection search. That is workable
 * for a curated collection and not for an arbitrarily large one, so there is a ceiling --
 * and passing it is an error rather than a silent search of the first N segments.
 */
const MAX_SEARCHABLE_COLLECTION_SEGMENTS = 20_000;

async function fetchCollectionSegmentIds(collectionId: number): Promise<number[]> {
  const rows = await CollectionSegment.createQueryBuilder('cs')
    .select('cs.segmentId', 'segmentId')
    .where('cs.collectionId = :collectionId', { collectionId })
    .orderBy('cs.id', 'ASC')
    .limit(MAX_SEARCHABLE_COLLECTION_SEGMENTS + 1)
    .getRawMany<{ segmentId: number | string }>();

  if (rows.length > MAX_SEARCHABLE_COLLECTION_SEGMENTS) {
    throw new InvalidRequestError(
      `This collection holds more than ${MAX_SEARCHABLE_COLLECTION_SEGMENTS} segments, which is more than search can filter on. Split it into smaller collections.`,
    );
  }

  return rows.map((row) => Number(row.segmentId)).filter(Number.isFinite);
}

/** Loads a collection the caller is allowed to *read*, or throws. Public collections are readable by anyone. */
async function loadReadableCollection(req: Request, collectionPublicId: string): Promise<Collection> {
  const user = assertUser(req);
  const collection = await Collection.findOneOrFail({ where: { publicId: collectionPublicId } });

  if (collection.visibility === CollectionVisibility.PUBLIC || collection.userId === user.id || isAdmin(user)) {
    return collection;
  }

  throw new AccessDeniedError('You do not have permission to view this collection.');
}

const toCategory = (value: string | undefined): CategoryOutput =>
  ALL_CATEGORIES.includes(value as CategoryType) ? (value as CategoryOutput) : CategoryType.ANIME;

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
