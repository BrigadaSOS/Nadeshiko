import { EntitySubscriberInterface, EventSubscriber, InsertEvent, UpdateEvent, RemoveEvent } from 'typeorm';
import { nanoid } from 'nanoid';
import { Segment } from '@app/entities';
import { sendEsSyncJob } from '@lib/queue/pgBoss';

@EventSubscriber()
export class SegmentSubscriber implements EntitySubscriberInterface<Segment> {
  listenTo() {
    return Segment;
  }

  beforeInsert(event: InsertEvent<Segment>) {
    if (!event.entity) return;

    if (!event.entity.uuid) {
      event.entity.uuid = nanoid();
    }
  }

  afterInsert(event: InsertEvent<Segment>) {
    if (event.entity) {
      // Enqueue ES sync job with retry
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
      // Enqueue ES sync job with retry
      sendEsSyncJob({
        segmentId: event.entity.id,
        operation: 'UPDATE',
      }).catch((error) => {
        console.error(`Failed to enqueue ES sync job for segment ${event.entity?.id} after update:`, error);
      });
    }
  }

  afterRemove(event: RemoveEvent<Segment>) {
    // databaseEntity contains the full entity before deletion
    if (event.databaseEntity) {
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
