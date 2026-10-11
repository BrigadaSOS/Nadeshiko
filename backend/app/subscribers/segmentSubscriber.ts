import { EntitySubscriberInterface, EventSubscriber, InsertEvent, UpdateEvent, RemoveEvent } from 'typeorm';
import { Segment } from '@app/models';
import { MEDIA_INFO_CACHE, type MediaInfoMapResult } from '@app/models/Media';
import { Cache } from '@lib/cache';
import { sendEsSyncJob } from '@app/workers/esSyncQueue';

@EventSubscriber()
export class SegmentSubscriber implements EntitySubscriberInterface<Segment> {
  listenTo() {
    return Segment;
  }

  afterInsert(event: InsertEvent<Segment>) {
    if (event.entity) {
      invalidateMediaInfoForUnknownMedia(event.entity.mediaId);
      sendEsSyncJob({ segmentId: event.entity.id, operation: 'CREATE' });
    }
  }

  afterUpdate(event: UpdateEvent<Segment>) {
    if (event.entity) {
      const statusChanged = event.updatedColumns?.some((col) => col.propertyName === 'status') ?? false;
      if (statusChanged) {
        Cache.invalidate(MEDIA_INFO_CACHE);
      }
      sendEsSyncJob({ segmentId: event.entity.id, operation: 'UPDATE' });
    }
  }

  afterRemove(event: RemoveEvent<Segment>) {
    if (event.databaseEntity) {
      Cache.invalidate(MEDIA_INFO_CACHE);
      sendEsSyncJob({ segmentId: event.databaseEntity.id, operation: 'DELETE' });
    }
  }
}

/** Segment insertion does not change denormalized media counts; invalidate only an unseen media, while count-writing
 * paths invalidate their own cache. */
function invalidateMediaInfoForUnknownMedia(mediaId: number): void {
  const cached = Cache.get<MediaInfoMapResult>(MEDIA_INFO_CACHE, 'all');
  if (cached?.results.has(mediaId)) return;

  Cache.invalidate(MEDIA_INFO_CACHE);
}
