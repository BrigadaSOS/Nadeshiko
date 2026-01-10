import { Media } from '@app/entities/Media';
import { Episode } from '@app/entities/Episode';

/**
 * Update numSegments cache for Media after segment changes
 */
export async function updateMediaSegmentCount(mediaId: number): Promise<void> {
  await Media.createQueryBuilder()
    .update()
    .set({
      numSegments: () => `(SELECT COUNT(*) FROM "Segment" WHERE "media_id" = :mediaId AND "status" != 0)`,
    })
    .where('id = :mediaId')
    .setParameter('mediaId', mediaId)
    .execute();

  Media.invalidateCache();
}

/**
 * Update numSegments cache for Episode after segment changes
 */
export async function updateEpisodeSegmentCount(mediaId: number, episodeNumber: number): Promise<void> {
  await Episode.createQueryBuilder()
    .update()
    .set({
      numSegments: () =>
        `(SELECT COUNT(*) FROM "Segment" WHERE "media_id" = :mediaId AND "episode" = :episodeNumber AND "status" != 0)`,
    })
    .where('media_id = :mediaId AND "episode_number" = :episodeNumber')
    .setParameter('mediaId', mediaId)
    .setParameter('episodeNumber', episodeNumber)
    .execute();

  // Also update the parent Media count since Episode segments contribute to Media total
  await updateMediaSegmentCount(mediaId);
}
