import { EntitySubscriberInterface, EventSubscriber, InsertEvent, UpdateEvent, RemoveEvent } from 'typeorm';
import { Segment } from '@app/models';
import { MEDIA_INFO_CACHE } from '@app/models/Media';
import { Cache } from '@lib/cache';
import { sendEsSyncJob } from '@app/workers/pgBoss';

@EventSubscriber()
export class SegmentSubscriber implements EntitySubscriberInterface<Segment> {
  listenTo() {
    return Segment;
  }

  afterInsert(event: InsertEvent<Segment>) {
    if (event.entity) {
      Cache.invalidate(MEDIA_INFO_CACHE);

      sendEsSyncJob({
        segmentId: event.entity.id,
        operation: 'CREATE',
      }).catch((error) => {
        console.error(`Failed to enqueue ES sync job for segment ${event.entity?.id} after create:`, error);
      });
    }
  }

  afterUpdate(event: UpdateEvent<Segment>) {
    if (event.entity) {
      sendEsSyncJob({
        segmentId: event.entity.id,
        operation: 'UPDATE',
      }).catch((error) => {
        console.error(`Failed to enqueue ES sync job for segment ${event.entity?.id} after update:`, error);
      });
    }
  }

  afterRemove(event: RemoveEvent<Segment>) {
    if (event.databaseEntity) {
      Cache.invalidate(MEDIA_INFO_CACHE);

      // Enqueue ES sync job with retry
      sendEsSyncJob({
        segmentId: event.databaseEntity.id,
        operation: 'DELETE',
      }).catch((error) => {
        console.error(`Failed to enqueue ES sync job for segment ${event.entityId} deletion:`, error);
      });
    }
  }
}
