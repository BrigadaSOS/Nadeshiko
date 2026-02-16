import type {
  ListIndex,
  ListShow,
  ListCreate,
  ListUpdate,
  ListDestroy,
  ListAddItem,
  ListUpdateItem,
  ListRemoveItem,
  ListGetSegments,
  ListAddSegment,
  ListUpdateSegment,
  ListRemoveSegment,
} from 'generated/routes/lists';
import { List, ListItem, ListSegmentItem, ListType, ListVisibility, Segment, UserRoleType } from '@app/models';
import { toListDTO, toListWithMediaDTO } from './mappers/list.mapper';
import { querySegmentsByUuids } from '@app/services/elasticsearch';
import { AccessDeniedError, NotFoundError } from '@app/errors';
import { trackActivity } from '@app/services/activityService';
import { ActivityType } from '@app/models/UserActivity';
import type { Request } from 'express';

const isAdmin = (req: Request): boolean => req.user?.role === UserRoleType.ADMIN;

const assertListOwnership = (list: List, req: Request): void => {
  if (list.userId !== req.user?.id && !isAdmin(req)) {
    throw new AccessDeniedError('You do not have permission to modify this list.');
  }
};

export const listIndex: ListIndex = async ({ query }, respond) => {
  const whereClause: any = {};

  if (query.visibility === 'public') {
    whereClause.visibility = ListVisibility.PUBLIC;
  } else if (query.visibility === 'private') {
    whereClause.visibility = ListVisibility.PRIVATE;
  }

  if (query.type) {
    whereClause.type = query.type as ListType;
  }

  if (query.userId) {
    whereClause.userId = query.userId;
  }

  let lists: List[];

  if (query.mediaId) {
    // Find lists containing this media
    const listItems = await ListItem.find({
      where: { mediaId: query.mediaId },
      relations: { list: true },
    });

    lists = listItems
      .map((item) => item.list)
      .filter((list) => {
        if (query.visibility === 'public') return list.visibility === ListVisibility.PUBLIC;
        if (query.visibility === 'private') return list.visibility === ListVisibility.PRIVATE;
        if (query.type) return list.type === query.type;
        if (query.userId) return list.userId === query.userId;
        return true;
      });
  } else {
    lists = await List.find({
      where: whereClause,
      order: { createdAt: 'DESC' },
    });
  }

  return respond.with200().body(lists.map(toListDTO));
};

export const listShow: ListShow = async ({ params }, respond) => {
  const list = await List.findOneOrFail({
    where: { id: params.id },
    relations: { items: { media: true } },
  });

  return respond.with200().body(toListWithMediaDTO(list));
};

export const listCreate: ListCreate = async ({ body }, respond, req) => {
  const list = await List.save({
    name: body.name,
    type: (body.type as ListType) || ListType.CUSTOM,
    userId: req.user?.id || body.userId || 1,
    visibility: (body.visibility as ListVisibility) || ListVisibility.PUBLIC,
  });

  return respond.with201().body(toListDTO(list));
};

export const listUpdate: ListUpdate = async ({ params, body }, respond, req) => {
  const list = await List.findOneOrFail({ where: { id: params.id } });
  assertListOwnership(list, req);

  if (body.name) list.name = body.name;
  if (body.visibility) list.visibility = body.visibility as ListVisibility;

  await list.save();

  return respond.with200().body(toListDTO(list));
};

export const listDestroy: ListDestroy = async ({ params }, respond, req) => {
  const list = await List.findOneOrFail({ where: { id: params.id } });
  assertListOwnership(list, req);

  await List.delete({ id: params.id });

  return respond.with200().body({
    message: 'List deleted successfully',
    id: params.id,
  });
};

export const listAddItem: ListAddItem = async ({ params, body }, respond, req) => {
  const list = await List.findOneOrFail({ where: { id: params.id } });
  assertListOwnership(list, req);

  await ListItem.save({
    listId: params.id,
    mediaId: body.mediaId,
    position: body.position,
  });

  return respond.with201().body({ message: 'Media added to list' });
};

export const listUpdateItem: ListUpdateItem = async ({ params, body }, respond, req) => {
  const list = await List.findOneOrFail({ where: { id: params.id } });
  assertListOwnership(list, req);

  const item = await ListItem.findOneOrFail({
    where: { listId: params.id, mediaId: params.mediaId },
  });

  item.position = body.position;
  await item.save();

  return respond.with200().body({ message: 'Position updated' });
};

export const listRemoveItem: ListRemoveItem = async ({ params }, respond, req) => {
  const list = await List.findOneOrFail({ where: { id: params.id } });
  assertListOwnership(list, req);

  await ListItem.delete({
    listId: params.id,
    mediaId: params.mediaId,
  });

  return respond.with200().body({ message: 'Media removed from list' });
};

export const listGetSegments: ListGetSegments = async ({ params, query }, respond) => {
  const list = await List.findOneOrFail({ where: { id: params.id } });

  const page = query.page || 1;
  const limit = Math.min(query.limit || 20, 100);
  const offset = (page - 1) * limit;

  const [segmentItems, totalCount] = await ListSegmentItem.findAndCount({
    where: { listId: list.id },
    order: { position: 'ASC' },
    skip: offset,
    take: limit,
  });

  if (segmentItems.length === 0) {
    return respond.with200().body({
      ...toListDTO(list),
      segments: [],
      totalCount,
    });
  }

  const uuids = segmentItems.map((item) => item.segmentUuid);
  const searchResults = await querySegmentsByUuids(uuids);

  // Map ES results by UUID for ordering
  const resultByUuid = new Map(searchResults.map((r) => [r.segment.uuid, r]));

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
    ...toListDTO(list),
    segments,
    totalCount,
  });
};

export const listAddSegment: ListAddSegment = async ({ params, body }, respond, req) => {
  const list = await List.findOneOrFail({ where: { id: params.id } });
  assertListOwnership(list, req);

  if (list.type !== ListType.SEGMENT) {
    throw new NotFoundError('This list does not support segment items.');
  }

  // Look up the segment to denormalize mediaId
  const segment = await Segment.findOneOrFail({ where: { uuid: body.segmentUuid } });

  // Auto-assign position (max + 1)
  const maxPositionResult = await ListSegmentItem.createQueryBuilder('item')
    .select('MAX(item.position)', 'maxPos')
    .where('item.listId = :listId', { listId: list.id })
    .getRawOne();

  const nextPosition = (maxPositionResult?.maxPos || 0) + 1;

  await ListSegmentItem.save({
    listId: list.id,
    segmentUuid: body.segmentUuid,
    mediaId: segment.mediaId,
    position: nextPosition,
    note: body.note || null,
  });

  // Track activity (fire-and-forget)
  if (req.user) {
    trackActivity(req.user, ActivityType.LIST_ADD_SEGMENT, {
      segmentUuid: body.segmentUuid,
      mediaId: segment.mediaId,
    }).catch(() => {});
  }

  return respond.with201().body({ message: 'Segment added to list' });
};

export const listUpdateSegment: ListUpdateSegment = async ({ params, body }, respond, req) => {
  const list = await List.findOneOrFail({ where: { id: params.id } });
  assertListOwnership(list, req);

  const item = await ListSegmentItem.findOneOrFail({
    where: { listId: params.id, segmentUuid: params.uuid },
  });

  if (body.position !== undefined) item.position = body.position;
  if (body.note !== undefined) item.note = body.note ?? null;

  await item.save();

  return respond.with200().body({ message: 'Segment updated' });
};

export const listRemoveSegment: ListRemoveSegment = async ({ params }, respond, req) => {
  const list = await List.findOneOrFail({ where: { id: params.id } });
  assertListOwnership(list, req);

  await ListSegmentItem.delete({
    listId: params.id,
    segmentUuid: params.uuid,
  });

  return respond.with200().body({ message: 'Segment removed from list' });
};
