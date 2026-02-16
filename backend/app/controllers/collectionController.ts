import type {
  CollectionIndex,
  CollectionShow,
  CollectionCreate,
  CollectionUpdate,
  CollectionDestroy,
  CollectionAddSegment,
  CollectionUpdateSegment,
  CollectionRemoveSegment,
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

export const collectionIndex: CollectionIndex = async ({ query }, respond, req) => {
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

  const limit = Math.min(query.limit || 20, 100);
  const page = query.page || 1;
  const offset = query.cursor ?? (page - 1) * limit;

  const [collections, totalCount] = await Collection.findAndCount({
    where: whereClause,
    order: { createdAt: 'DESC' },
    skip: offset,
    take: limit,
  });

  const hasMore = offset + collections.length < totalCount;
  const nextCursor = hasMore ? offset + collections.length : null;

  return respond.with200().body({
    collections: collections.map(toCollectionDTO),
    pagination: {
      hasMore,
      cursor: nextCursor,
    },
  });
};

export const collectionShow: CollectionShow = async ({ params, query }, respond) => {
  const collection = await Collection.findOneOrFail({ where: { id: params.id } });

  const limit = Math.min(query.limit || 20, 100);
  const page = query.page || 1;
  const offset = query.cursor ?? (page - 1) * limit;

  const [segmentItems, totalCount] = await CollectionSegment.findAndCount({
    where: { collectionId: collection.id },
    order: { position: 'ASC' },
    skip: offset,
    take: limit,
  });

  const hasMore = offset + segmentItems.length < totalCount;
  const nextCursor = hasMore ? offset + segmentItems.length : null;

  if (segmentItems.length === 0) {
    return respond.with200().body({
      ...toCollectionDTO(collection),
      segments: [],
      totalCount,
      pagination: {
        hasMore,
        cursor: nextCursor,
      },
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
    pagination: {
      hasMore,
      cursor: nextCursor,
    },
  });
};

export const collectionCreate: CollectionCreate = async ({ body }, respond, req) => {
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

export const collectionUpdate: CollectionUpdate = async ({ params, body }, respond, req) => {
  const collection = await Collection.findOneOrFail({ where: { id: params.id } });
  assertCollectionOwnership(collection, req);

  if (body.name) collection.name = body.name;
  if (body.visibility) collection.visibility = body.visibility as CollectionVisibility;

  await collection.save();

  return respond.with200().body(toCollectionDTO(collection));
};

export const collectionDestroy: CollectionDestroy = async ({ params }, respond, req) => {
  const collection = await Collection.findOneOrFail({ where: { id: params.id } });
  assertCollectionOwnership(collection, req);

  await Collection.delete({ id: params.id });

  return respond.with204();
};

export const collectionAddSegment: CollectionAddSegment = async ({ params, body }, respond, req) => {
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

export const collectionUpdateSegment: CollectionUpdateSegment = async ({ params, body }, respond, req) => {
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

export const collectionRemoveSegment: CollectionRemoveSegment = async ({ params }, respond, req) => {
  const collection = await Collection.findOneOrFail({ where: { id: params.id } });
  assertCollectionOwnership(collection, req);

  await CollectionSegment.delete({
    collectionId: params.id,
    segmentUuid: params.uuid,
  });

  return respond.with204();
};
