import type {
  ListIndex,
  ListShow,
  ListCreate,
  ListUpdate,
  ListDestroy,
  ListAddItem,
  ListUpdateItem,
  ListRemoveItem,
} from 'generated/routes/lists';
import { List, ListItem, ListType, ListVisibility } from '@app/entities';
import { toListDTO, toListWithMediaDTO } from './mappers/list.mapper';

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

export const listCreate: ListCreate = async ({ body }, respond) => {
  const list = await List.save({
    name: body.name,
    type: (body.type as ListType) || ListType.CUSTOM,
    userId: body.userId || 1,
    visibility: (body.visibility as ListVisibility) || ListVisibility.PUBLIC,
  });

  return respond.with201().body(toListDTO(list));
};

export const listUpdate: ListUpdate = async ({ params, body }, respond) => {
  const list = await List.findOneOrFail({ where: { id: params.id } });

  if (body.name) list.name = body.name;
  if (body.visibility) list.visibility = body.visibility as ListVisibility;

  await list.save();

  return respond.with200().body(toListDTO(list));
};

export const listDestroy: ListDestroy = async ({ params }, respond) => {
  await List.delete({ id: params.id });

  return respond.with200().body({
    message: 'List deleted successfully',
    id: params.id,
  });
};

export const listAddItem: ListAddItem = async ({ params, body }, respond) => {
  await ListItem.save({
    listId: params.id,
    mediaId: body.mediaId,
    position: body.position,
  });

  return respond.with201().body({ message: 'Media added to list' });
};

export const listUpdateItem: ListUpdateItem = async ({ params, body }, respond) => {
  const item = await ListItem.findOneOrFail({
    where: { listId: params.id, mediaId: params.mediaId },
  });

  item.position = body.position;
  await item.save();

  return respond.with200().body({ message: 'Position updated' });
};

export const listRemoveItem: ListRemoveItem = async ({ params }, respond) => {
  await ListItem.delete({
    listId: params.id,
    mediaId: params.mediaId,
  });

  return respond.with200().body({ message: 'Media removed from list' });
};
