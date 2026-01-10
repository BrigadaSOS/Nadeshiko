import { EntitySubscriberInterface, EventSubscriber, InsertEvent, UpdateEvent, RemoveEvent } from 'typeorm';
import { v3 as uuidv3 } from 'uuid';
import { Segment } from '@app/entities';
import { syncSegment } from '@app/services/elasticsearchSync';

@EventSubscriber()
export class SegmentSubscriber implements EntitySubscriberInterface<Segment> {
  // Listen for Segment entity
  listenTo() {
    return Segment;
  }

  // BeforeInsert - generateLength and generateUUID
  beforeInsert(event: InsertEvent<Segment>) {
    if (!event.entity) return;

    // Generate UUID if not present
    if (!event.entity.uuid) {
      const uuidNamespace: string | undefined = process.env.UUID_NAMESPACE?.toString();
      const unique_base_id = `${event.entity.mediaId}-${event.entity.episode}-${event.entity.position}`;
      event.entity.uuid = uuidv3(unique_base_id, uuidNamespace!);
    }

    // Generate content length if not present
    if (!event.entity.contentLength && event.entity.content) {
      event.entity.contentLength = event.entity.content.length;
    }
  }

  // AfterInsert - syncToElasticsearchCreate
  afterInsert(event: InsertEvent<Segment>) {
    if (event.entity) {
      // Non-blocking sync - don't wait for result
      syncSegment(event.entity, 'CREATE').catch((error) => {
        console.error(`Failed to sync segment ${event.entity!.id} to ES after create:`, error);
      });
    }
  }

  // AfterUpdate - syncToElasticsearchUpdate
  afterUpdate(event: UpdateEvent<Segment>) {
    if (event.entity) {
      // Non-blocking sync - don't wait for result
      syncSegment(event.entity as Segment, 'UPDATE').catch((error) => {
        console.error(`Failed to sync segment ${event.entity!.id} to ES after update:`, error);
      });
    }
  }

  // AfterRemove - syncToElasticsearchDelete
  afterRemove(event: RemoveEvent<Segment>) {
    // Create a minimal segment object for deletion
    const segment = new Segment();
    segment.id = Number(event.entityId);
    segment.position = 0;
    segment.status = 1;
    segment.isNsfw = false;
    segment.contentLength = 0;
    segment.mediaId = 0;

    // Non-blocking sync - don't wait for result
    syncSegment(segment, 'DELETE').catch((error) => {
      console.error(`Failed to sync segment ${event.entityId} deletion to ES:`, error);
    });
  }
}
