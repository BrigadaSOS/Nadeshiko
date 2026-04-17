import type { TriggerReindex } from 'generated/routes/admin';
import type { t_TriggerReindexRequestBodySchema } from 'generated/models';
import { Cache } from '@lib/cache';
import { reindexZeroDowntime } from '@config/elasticsearch';
import { SegmentDocument, type ReindexMediaItem } from '@app/models/SegmentDocument';
import { WordFrequency } from '@app/models';
import { logger } from '@config/log';

export const triggerReindex: TriggerReindex = async ({ body }, respond) => {
  const mediaItems = toReindexMediaItems(body);
  const isFullReindex = !mediaItems || mediaItems.length === 0;

  const result = isFullReindex
    ? await reindexZeroDowntime((targetIndex) => SegmentDocument.reindex(undefined, targetIndex))
    : await SegmentDocument.reindex(mediaItems);

  Cache.invalidate(SegmentDocument.SEARCH_STATS_CACHE);

  WordFrequency.updateCoverage({ onlyUncovered: true }).catch((err) =>
    logger.error({ err }, 'Word coverage update after reindex failed'),
  );

  return respond.with200().body(result);
};


function toReindexMediaItems(body: t_TriggerReindexRequestBodySchema | undefined): ReindexMediaItem[] | undefined {
  return body?.media?.map((item) => ({
    mediaId: item.mediaId,
    episodes: item.episodes,
  }));
}
