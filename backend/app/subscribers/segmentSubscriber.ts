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

/**
 * Inserting a segment does not move anything the media info map serves: the per-media and
 * per-episode counts in it are denormalized columns written by other paths, and those paths
 * invalidate the namespace themselves. Dropping the whole namespace once per row meant an
 * ingest run kept the map permanently cold -- it never survived long enough to be read twice,
 * so every concurrent search rebuilt it. What is worth catching is a media the cached map has
 * never seen, which is the one case where serving the cached copy would hide a whole title.
 */
function invalidateMediaInfoForUnknownMedia(mediaId: number): void {
  const cached = Cache.get<MediaInfoMapResult>(MEDIA_INFO_CACHE, 'all');
  if (cached?.results.has(mediaId)) return;

  Cache.invalidate(MEDIA_INFO_CACHE);
}
