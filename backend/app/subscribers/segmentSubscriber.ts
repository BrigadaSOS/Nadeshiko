import { EntitySubscriberInterface, EventSubscriber, InsertEvent, UpdateEvent, RemoveEvent } from 'typeorm';
import { Segment } from '@app/models';
import { MEDIA_INFO_CACHE, type MediaInfoMapResult } from '@app/models/Media';
import { Cache } from '@lib/cache';
import { sendEsSyncJob } from '@app/workers/esSyncQueue';
import { sendRecurringRecomputeJob } from '@app/workers/recurringLinesQueue';

/** Columns the recurring-line rule reads (see `recurringLines.ts`): a change to any of them can make this or another
 * segment of the same title a repeat, or stop it being one. */
const RECURRING_RULE_COLUMNS = new Set(['contentJa', 'status', 'episode', 'position', 'mediaId']);

@EventSubscriber()
export class SegmentSubscriber implements EntitySubscriberInterface<Segment> {
  listenTo() {
    return Segment;
  }

  afterInsert(event: InsertEvent<Segment>) {
    if (event.entity) {
      invalidateMediaInfoForUnknownMedia(event.entity.mediaId);
      sendEsSyncJob({ segmentId: event.entity.id, operation: 'CREATE' });
      void sendRecurringRecomputeJob(event.entity.mediaId);
    }
  }

  afterUpdate(event: UpdateEvent<Segment>) {
    if (event.entity) {
      const statusChanged = event.updatedColumns?.some((col) => col.propertyName === 'status') ?? false;
      if (statusChanged) {
        Cache.invalidate(MEDIA_INFO_CACHE);
      }
      sendEsSyncJob({ segmentId: event.entity.id, operation: 'UPDATE' });

      const ruleInputChanged =
        event.updatedColumns?.some((col) => RECURRING_RULE_COLUMNS.has(col.propertyName)) ?? false;
      const mediaId = event.entity.mediaId ?? event.databaseEntity?.mediaId;
      if (ruleInputChanged && mediaId) void sendRecurringRecomputeJob(mediaId);
    }
  }

  afterRemove(event: RemoveEvent<Segment>) {
    if (event.databaseEntity) {
      Cache.invalidate(MEDIA_INFO_CACHE);
      sendEsSyncJob({ segmentId: event.databaseEntity.id, operation: 'DELETE' });
      void sendRecurringRecomputeJob(event.databaseEntity.mediaId);
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
