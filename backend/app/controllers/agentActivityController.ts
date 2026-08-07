import type { ListAgentActivity } from 'generated/routes/admin';
import { SegmentRevision, RevisionActor, Media } from '@app/models';
import { toSegmentSnapshot } from '@app/controllers/mappers/segmentMapper';

const DEFAULT_WINDOW_MS = 24 * 60 * 60 * 1000;
const DEFAULT_TAKE = 100;

/**
 * What the moderation agent actually changed, read back from the revisions it wrote.
 *
 * Deliberately sourced from `SegmentRevision` rather than from anything the agent
 * reports about itself. The agent's Discord digest is its own account of a run and
 * shares the run's failure modes — a crash mid-loop, an action it believed
 * succeeded, a mutation it never mentioned. This reads the rows, so the two can
 * disagree and the disagreement is the signal.
 */
export const listAgentActivity: ListAgentActivity = async ({ query }, respond) => {
  const since = query.since ? new Date(query.since) : new Date(Date.now() - DEFAULT_WINDOW_MS);
  const take = query.take ?? DEFAULT_TAKE;

  const qb = SegmentRevision.createQueryBuilder('revision')
    .innerJoinAndSelect('revision.segment', 'segment')
    .leftJoinAndSelect('revision.user', 'user')
    .where('revision.actor = :actor', { actor: RevisionActor.AGENT })
    .andWhere('revision.createdAt >= :since', { since })
    // Property names, not column names. `take` makes TypeORM build a DISTINCT-id
    // subquery for the joins, and resolving the sort against entity metadata fails
    // on a raw column name — snake_case here throws `undefined.databaseName`
    // rather than producing bad SQL, so it is not caught by a test that only
    // checks the happy path's shape.
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
    ? await Media.find({ where: mediaIds.map((id) => ({ id })), select: ['id', 'publicId'] })
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
