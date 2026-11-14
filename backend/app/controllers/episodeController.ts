import type { ListEpisodes, CreateEpisode, GetEpisode, UpdateEpisode, DeleteEpisode } from 'generated/routes/media';
import { Episode, Media, Segment } from '@app/models';
import { DuplicateKeyError } from '@app/errors';
import { enqueueSegmentEsDeletes } from './mediaController';
import { toEpisodeDTO, toEpisodeListDTO } from './mappers/episodeMapper';
import { encodeKeysetCursor, decodeKeysetCursor } from '@lib/cursor';
import { Cache } from '@lib/cache';
import { MEDIA_INFO_CACHE } from '@app/models/Media';
import { SegmentDocument } from '@app/services/search/SegmentDocument';
import { sendRecurringRecomputeJob } from '@app/workers/recurringLinesQueue';

/** Episode writes invalidate both caches because each contains per-media episode totals; media writes already follow
 * this rule. */
function invalidateEpisodeDerivedCaches(): void {
  Cache.invalidate(MEDIA_INFO_CACHE);
  Cache.invalidate(SegmentDocument.SEARCH_STATS_CACHE);
}

export const listEpisodes: ListEpisodes = async ({ params, query }, respond) => {
  // findOneOrFail handles the 404 case if the media doesn't exist
  const media = await Media.findOneOrFail({ where: { publicId: params.mediaPublicId } });

  const take = query.take;
  const afterEpisodeNumber = decodeKeysetCursor<number>(query.cursor);

  const qb = Episode.createQueryBuilder('episode')
    .where('episode.mediaId = :mediaId', { mediaId: media.id })
    .orderBy('episode.episodeNumber', 'ASC')
    .take(take + 1);

  if (afterEpisodeNumber !== undefined) {
    qb.andWhere('episode.episodeNumber > :after', { after: afterEpisodeNumber });
  }

  const rows = await qb.getMany();
  const hasMore = rows.length > take;
  const episodes = hasMore ? rows.slice(0, take) : rows;
  const lastEpisode = episodes[episodes.length - 1];
  const nextCursor = hasMore && lastEpisode ? encodeKeysetCursor(lastEpisode.episodeNumber) : null;

  return respond.with200().body({
    episodes: toEpisodeListDTO(episodes, media.publicId),
    pagination: { hasMore, cursor: nextCursor },
  });
};

export const createEpisode: CreateEpisode = async ({ params, body }, respond) => {
  const media = await Media.findOneOrFail({ where: { publicId: params.mediaPublicId } });

  if (body.externalVideoId) {
    const existing = await Episode.findOne({
      where: { mediaId: media.id, externalVideoId: body.externalVideoId },
    });
    if (existing) {
      return respond.with201().body(toEpisodeDTO(existing, media.publicId));
    }

    // Only for a clearer message: the insert below is what guarantees the 409.
    const taken = await Episode.findOne({ where: { mediaId: media.id, episodeNumber: body.episodeNumber } });
    if (taken) {
      throw new DuplicateKeyError(
        `Episode ${body.episodeNumber} already belongs to video ${taken.externalVideoId ?? '(none)'}; ` +
          'give the new video the next free episode number.',
      );
    }
  }

  // Insert, never upsert: an episode number that is already taken answers 409 DUPLICATE_KEY (Postgres unique
  // violation on the primary key) instead of replacing that episode, which kept its segments and silently took
  // another video's. Atomic, so it also holds for concurrent creates and for creates without externalVideoId.
  await Episode.insert({
    mediaId: media.id,
    episodeNumber: body.episodeNumber,
    titleEn: body.titleEn,
    titleRomaji: body.titleRomaji,
    titleJa: body.titleJa,
    description: body.description,
    airedAt: body.airedAt,
    lengthSeconds: body.lengthSeconds,
    thumbnailUrl: body.thumbnailUrl,
    externalVideoId: body.externalVideoId,
  });
  const episode = await Episode.findOneByOrFail({ mediaId: media.id, episodeNumber: body.episodeNumber });

  invalidateEpisodeDerivedCaches();

  return respond.with201().body(toEpisodeDTO(episode, media.publicId));
};

export const getEpisode: GetEpisode = async ({ params }, respond) => {
  const media = await Media.findOneOrFail({ where: { publicId: params.mediaPublicId } });

  const episode = await Episode.findOneOrFail({
    where: {
      mediaId: media.id,
      episodeNumber: params.episodeNumber,
    },
  });

  return respond.with200().body(toEpisodeDTO(episode, media.publicId));
};

export const updateEpisode: UpdateEpisode = async ({ params, body }, respond) => {
  const media = await Media.findOneOrFail({ where: { publicId: params.mediaPublicId } });

  const episode = await Episode.findAndUpdateOrFail({
    where: { mediaId: media.id, episodeNumber: params.episodeNumber },
    patch: body,
  });

  return respond.with200().body(toEpisodeDTO(episode, media.publicId));
};

export const deleteEpisode: DeleteEpisode = async ({ params }, respond) => {
  const media = await Media.findOneOrFail({ where: { publicId: params.mediaPublicId } });

  const segmentIds = await Segment.createQueryBuilder('s')
    .select('s.id')
    .where('s.mediaId = :mediaId AND s.episode = :episode', {
      mediaId: media.id,
      episode: params.episodeNumber,
    })
    .getMany()
    .then((rows) => rows.map((r) => r.id));

  await Episode.deleteOrFail({ where: { mediaId: media.id, episodeNumber: params.episodeNumber } });

  await enqueueSegmentEsDeletes(segmentIds);
  // The episode's segments are gone by cascade, with no subscriber: a line may now recur in too few episodes, or have
  // a different first episode, so the title's remaining segments are recomputed.
  await sendRecurringRecomputeJob(media.id);

  invalidateEpisodeDerivedCaches();

  return respond.with204();
};
