import type { ListAgentActivity } from 'generated/routes/admin';
import { SegmentRevision, RevisionActor, Media } from '@app/models';
import { toSegmentSnapshot } from '@app/controllers/mappers/segmentMapper';

const DEFAULT_WINDOW_MS = 24 * 60 * 60 * 1000;
const DEFAULT_TAKE = 100;

/** Read moderation changes from `SegmentRevision`, not the agent report: revisions are the recorded writes and
 * expose disagreement after a failed run. */
export const listAgentActivity: ListAgentActivity = async ({ query }, respond) => {
  const since = query.since ? new Date(query.since) : new Date(Date.now() - DEFAULT_WINDOW_MS);
  const take = query.take ?? DEFAULT_TAKE;

  const qb = SegmentRevision.createQueryBuilder('revision')
    .innerJoinAndSelect('revision.segment', 'segment')
    .leftJoinAndSelect('revision.user', 'user')
    .where('revision.actor = :actor', { actor: RevisionActor.AGENT })
    .andWhere('revision.createdAt >= :since', { since })
    // Use entity property names, not column names: TypeORM’s `take`/DISTINCT path cannot resolve raw names and fails
    // before producing SQL.
    .orderBy('revision.createdAt', 'DESC')
    .addOrderBy('revision.id', 'DESC')
    .take(take);

  if (query.reportId !== undefined) {
    qb.andWhere('revision.reportId = :reportId', { reportId: query.reportId });
  }

  const revisions = await qb.getMany();

  // One lookup for the whole page instead of a join per row: revisions cluster
  // heavily on a handful of media, so the map is almost always much smaller than
  // the page.
  const mediaIds = [...new Set(revisions.map((r) => r.segment.mediaId))];
  const media = mediaIds.length
    ? await Media.find({
        where: mediaIds.map((id) => ({ id })),
        select: {
          id: true,
          publicId: true,
        },
      })
    : [];
  const mediaPublicIdById = new Map(media.map((m) => [m.id, m.publicId]));

  return respond.with200().body({
    entries: revisions.map((revision) => ({
      revisionId: revision.id,
      revisionNumber: revision.revisionNumber,
      segmentPublicId: revision.segment.publicId,
      mediaPublicId: mediaPublicIdById.get(revision.segment.mediaId) ?? '',
      episodeNumber: revision.segment.episode,
      snapshot: revision.snapshot,
      current: toSegmentSnapshot(revision.segment),
      reportId: revision.reportId ?? null,
      actedBy: revision.user?.username ?? null,
      createdAt: revision.createdAt.toISOString(),
    })),
  });
};
