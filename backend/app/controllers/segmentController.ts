import type {
  ListSegments,
  CreateSegment,
  CreateSegmentsBatch,
  GetSegment,
  GetSegmentContext,
  UpdateSegment,
  ListSegmentRevisions,
  RestoreSegmentRevision,
  ModerateEpisodeSegments,
} from 'generated/routes/media';
import type { SegmentUpdateRequestOutput, ModerateEpisodeSegmentsRequestOutput } from 'generated/outputTypes';
import type { EntityManager } from 'typeorm';
import {
  Segment,
  SegmentStatus,
  Episode,
  Media,
  SegmentRevision,
  RevisionActor,
  ExternalSourceType,
} from '@app/models';
import { AuthType, ApiKeyKind } from '@app/models/ApiPermission';
import { MEDIA_INFO_CACHE } from '@app/models/Media';
import {
  toSegmentCreateAttributes,
  toSegmentDTO,
  toSegmentInternalDTO,
  toSegmentListDTO,
  toSegmentSnapshot,
  fromSegmentSnapshot,
  toSegmentRevisionDTO,
  toSegmentUpdatePatch,
} from './mappers/segmentMapper';
import { toSearchResponseDTO } from './mappers/searchMapper';
import { sendBulkEsSyncJobs } from '@app/workers/esSyncQueue';
import { sendBulkTokenParseJobs, sendTokenParseJob } from '@app/workers/tokenParseQueue';
import { Cache } from '@lib/cache';
import { logger } from '@config/log';
import { assertUser } from '@app/middleware/authentication';
import { InvalidRequestError, NotFoundError } from '@app/errors';
import { surroundingSegments } from '@app/services/search/segmentDocument/SegmentContext';
import { assessWakati, describeWakati } from '@app/services/corpus/wakatiDetection';

export const listSegments: ListSegments = async ({ params, query }, respond) => {
  const media = await Media.findOneOrFail({ where: { publicId: params.mediaPublicId } });

  const { items: segments, pagination } = await Segment.paginateWithKeyset({
    take: query.take,
    cursor: query.cursor,
    orderBy: { column: 'id', direction: 'ASC' },
    exists: {
      entity: Episode,
      where: { mediaId: media.id, episodeNumber: params.episodeNumber },
    },
    query: () =>
      Segment.createQueryBuilder('segment').where('segment.mediaId = :mediaId AND segment.episode = :episode', {
        mediaId: media.id,
        episode: params.episodeNumber,
      }),
  });

  return respond.with200().body({
    segments: toSegmentListDTO(segments, media.publicId),
    pagination,
  });
};

export const createSegment: CreateSegment = async ({ params, body }, respond) => {
  const media = await Media.findOneOrFail({
    where: { publicId: params.mediaPublicId },
    relations: {
      externalIds: true,
    },
  });
  const externalVideoId = await getEpisodeExternalVideoId(media.id, params.episodeNumber);

  const segment = Segment.create(
    toSegmentCreateAttributes({
      mediaId: media.id,
      primaryExternalId: getPrimaryExternalId(media),
      airingFormat: media.airingFormat,
      episodeNumber: params.episodeNumber,
      externalVideoId,
      storageBasePath: media.storageBasePath,
      body,
    }),
  ) as Segment;
  await segment.save();

  await sendTokenParseJob(segment.id);

  return respond.with201().body(toSegmentInternalDTO(segment, undefined, media.publicId));
};

export const createSegmentsBatch: CreateSegmentsBatch = async ({ params, body }, respond) => {
  const media = await Media.findOneOrFail({
    where: { publicId: params.mediaPublicId },
    relations: {
      externalIds: true,
    },
  });

  // Validate a batch at the episode level because one segment has no population for the `wakatiDetection` signal.
  const wakati = assessWakati(body.segments.map((segmentBody) => segmentBody.textJa?.content ?? ''));
  if (wakati.isWakati) {
    logger.warn(
      { mediaPublicId: media.publicId, episode: params.episodeNumber, ...wakati },
      'Rejected a wakati-segmented segment batch',
    );
    throw new InvalidRequestError(describeWakati(wakati));
  }

  const primaryExternalId = getPrimaryExternalId(media);
  const externalVideoId = await getEpisodeExternalVideoId(media.id, params.episodeNumber);
  const attributes = body.segments.map((segmentBody) =>
    toSegmentCreateAttributes({
      mediaId: media.id,
      primaryExternalId,
      airingFormat: media.airingFormat,
      episodeNumber: params.episodeNumber,
      externalVideoId,
      storageBasePath: media.storageBasePath,
      body: segmentBody,
    }),
  );

  // Upsert reprocessed segments so deleted/hidden rows reactivate with new content instead of requiring hard deletion.
  const result = await Segment.createQueryBuilder()
    .insert()
    .into(Segment)
    .values(attributes)
    .orUpdate(
      [
        'status',
        'position',
        'start_time_ms',
        'end_time_ms',
        'content',
        'content_english',
        'content_english_mt',
        'content_spanish',
        'content_spanish_mt',
        'content_rating',
        'rating_analysis',
        'storage',
        'hashed_id',
        'storage_base_path',
        'updated_at',
      ],
      ['uuid'],
    )
    .execute();

  const allIds = result.identifiers.filter((id) => id?.id !== undefined).map((id) => id.id as number);

  if (allIds.length > 0) {
    sendBulkEsSyncJobs(allIds.map((segmentId) => ({ segmentId, operation: 'CREATE' as const }))).catch((error) => {
      logger.error({ err: error }, 'Failed to enqueue bulk ES sync jobs for batch segment creation');
    });

    // Index immediately and tokenize asynchronously; Shirabe outage must not block search, and both sync handlers
    // re-read Postgres before writing.
    sendBulkTokenParseJobs(allIds).catch((error) => {
      logger.error({ err: error }, 'Failed to enqueue token parse jobs for batch segment creation');
    });

    Cache.invalidate(MEDIA_INFO_CACHE);
  }

  return respond.with201().body({ created: allIds.length, skipped: attributes.length - allIds.length });
};

export const updateSegment: UpdateSegment = async ({ params, body }, respond, req) => {
  const { segment, mediaPublicId } = await findSegmentByUuidOrPublicId(params.segmentPublicId);

  const updated = await applySegmentUpdate(segment.id, body, {
    userId: assertUser(req).id,
    actor: resolveRevisionActor(req),
    reportId: body.reportId ?? null,
  });

  return respond.with200().body(toSegmentInternalDTO(updated, undefined, mediaPublicId));
};

export const getSegment: GetSegment = async ({ params }, respond) => {
  const { segment, mediaPublicId } = await findSegmentByUuidOrPublicId(params.segmentPublicId);

  return respond.with200().body(toSegmentDTO(segment, mediaPublicId));
};

export const listSegmentRevisions: ListSegmentRevisions = async ({ params }, respond) => {
  const { segment } = await findSegmentByUuidOrPublicId(params.segmentPublicId);

  const revisions = await SegmentRevision.find({
    where: { segmentId: segment.id },
    relations: {
      user: true,
    },
    order: { revisionNumber: 'DESC' },
  });

  return respond.with200().body({
    revisions: revisions.map((r) => toSegmentRevisionDTO(r, r.user?.username ?? null)),
  });
};

export const restoreSegmentRevision: RestoreSegmentRevision = async ({ params }, respond, req) => {
  const { segment, mediaPublicId } = await findSegmentByUuidOrPublicId(params.segmentPublicId);

  const restored = await applyRevisionRestore(segment.id, params.revisionNumber, {
    userId: assertUser(req).id,
    actor: resolveRevisionActor(req),
    // A restore fixes an edit, not its originating report; keep report linkage null so activity means “edit made for
    // this report.”
    reportId: null,
  });

  return respond.with200().body(toSegmentInternalDTO(restored, undefined, mediaPublicId));
};

export const moderateEpisodeSegments: ModerateEpisodeSegments = async ({ params, body }, respond, req) => {
  const media = await Media.findOne({
    where: { publicId: params.mediaPublicId },
    select: {
      id: true,
    },
  });
  if (!media) {
    throw new NotFoundError(`Media with publicId ${params.mediaPublicId} not found`);
  }

  if (body.action === 'shiftTimings' && body.offsetMs === undefined) {
    throw new InvalidRequestError('offsetMs is required for the shiftTimings action');
  }
  if (body.action === 'setStatus' && body.status === undefined) {
    throw new InvalidRequestError('status is required for the setStatus action');
  }

  const affected = await applyEpisodeModeration(media.id, params.episodeNumber, body, {
    userId: assertUser(req).id,
    actor: resolveRevisionActor(req),
    reportId: body.reportId ?? null,
  });

  return respond.with200().body({ count: affected });
};

export const getSegmentContext: GetSegmentContext = async ({ params, query }, respond) => {
  const { segment } = await findSegmentByUuidOrPublicId(params.segmentPublicId);

  const searchResults = await surroundingSegments({
    mediaId: segment.mediaId,
    episodeNumber: segment.episode,
    segmentPosition: segment.position,
    limit: query.take || 3,
    contentRating: query.contentRating,
  });

  return respond.with200().body(toSearchResponseDTO(searchResults, query.include));
};

async function findSegmentByUuidOrPublicId(
  uuidOrPublicId: string,
): Promise<{ segment: Segment; mediaPublicId: string }> {
  const segment = await Segment.findOne({
    where: [{ uuid: uuidOrPublicId }, { publicId: uuidOrPublicId }],
  });
  if (!segment) {
    throw new NotFoundError('Segment not found');
  }
  const media = await Media.findOneOrFail({
    where: { id: segment.mediaId },
    select: {
      publicId: true,
    },
  });
  return { segment, mediaPublicId: media.publicId };
}

function getPrimaryExternalId(media: Media): string {
  const preferred = [
    ExternalSourceType.ANILIST,
    ExternalSourceType.TMDB,
    ExternalSourceType.TVDB,
    ExternalSourceType.IMDB,
    ExternalSourceType.YOUTUBE,
  ];
  for (const source of preferred) {
    const ext = media.externalIds?.find((e) => e.source === source);
    if (ext) return ext.externalId;
  }
  throw new InvalidRequestError(`Media ${media.id} is missing an external ID (AniList, TMDB, YouTube, etc.)`);
}

async function getEpisodeExternalVideoId(mediaId: number, episodeNumber: number): Promise<string | null> {
  const episode = await Episode.findOne({
    where: { mediaId, episodeNumber },
    select: {
      externalVideoId: true,
    },
  });
  return episode?.externalVideoId ?? null;
}

/** Record service-key writes as agent edits; the key belongs to a real user, so `userId` alone cannot distinguish
 * agent from person. */
export function resolveRevisionActor(req: {
  auth?: { type: AuthType; apiKey?: { kind?: ApiKeyKind } };
}): RevisionActor {
  const isServiceKey = req.auth?.type === AuthType.API_KEY && req.auth.apiKey?.kind === ApiKeyKind.SERVICE;
  return isServiceKey ? RevisionActor.AGENT : RevisionActor.HUMAN;
}

export type RevisionProvenance = {
  userId: number;
  actor: RevisionActor;
  reportId: number | null;
};

/** Offsets in `SlimToken` belong to the parsed sentence; clear them on edits and enqueue reparsing after commit,
 * because wrong offsets corrupt highlights. */
function clearTokensIfJapaneseChanged(segment: Segment, previousJa: string): boolean {
  if (segment.contentJa === previousJa) return false;

  segment.tokens = null;
  return true;
}

async function applySegmentUpdate(
  segmentId: number,
  body: SegmentUpdateRequestOutput,
  provenance: RevisionProvenance,
): Promise<Segment> {
  // The revision is this edit's audit trail, so it is written in the same
  // transaction as the edit: a caller that gets a 200 has both rows, or neither.
  const { segment, reparse } = await Segment.getRepository().manager.transaction(async (manager) => {
    // Lock the segment while assigning its next revision; concurrent writers otherwise collide and snapshot the same
    // stale pre-state.
    const segment = await manager
      .createQueryBuilder(Segment, 'segment')
      .setLock('pessimistic_write')
      .where('segment.id = :id', { id: segmentId })
      .getOneOrFail();

    const snapshot = toSegmentSnapshot(segment);
    const previousJa = segment.contentJa;
    Object.assign(segment, toSegmentUpdatePatch(body));
    const reparse = clearTokensIfJapaneseChanged(segment, previousJa);
    await manager.save(segment);

    await createSegmentRevision(manager, segmentId, snapshot, provenance);

    return { segment, reparse };
  });

  // Enqueue only after commit; a worker started mid-transaction could read the old sentence and write stale tokens.
  if (reparse) await sendTokenParseJob(segment.id);

  return segment;
}

/** Restores append a new revision instead of rewinding the counter, preserving an undoable, append-only history. */
async function applyRevisionRestore(
  segmentId: number,
  revisionNumber: number,
  provenance: RevisionProvenance,
): Promise<Segment> {
  const { segment, reparse } = await Segment.getRepository().manager.transaction(async (manager) => {
    const segment = await manager
      .createQueryBuilder(Segment, 'segment')
      .setLock('pessimistic_write')
      .where('segment.id = :id', { id: segmentId })
      .getOneOrFail();

    const target = await manager.findOne(SegmentRevision, { where: { segmentId, revisionNumber } });
    if (!target) {
      throw new NotFoundError(`Segment has no revision ${revisionNumber}`);
    }

    const snapshot = toSegmentSnapshot(segment);
    const previousJa = segment.contentJa;
    Object.assign(segment, fromSegmentSnapshot(target.snapshot));
    // A snapshot carries the sentence but never its analysis, so a restore that
    // moves the Japanese needs the same treatment as an edit that does.
    const reparse = clearTokensIfJapaneseChanged(segment, previousJa);
    // `save` rather than a query-builder update: the ES reindex rides on the
    // entity's afterUpdate subscriber, and a query-builder update does not fire it.
    await manager.save(segment);

    await createSegmentRevision(manager, segmentId, snapshot, provenance);

    return { segment, reparse };
  });

  if (reparse) await sendTokenParseJob(segment.id);

  return segment;
}

/** Check `maxAffected` before writing; create one revision per segment through entities/subscribers, then enqueue
 * work after commit so search reindexes. */
async function applyEpisodeModeration(
  mediaId: number,
  episodeNumber: number,
  body: ModerateEpisodeSegmentsRequestOutput,
  provenance: RevisionProvenance,
): Promise<number> {
  return Segment.getRepository().manager.transaction(async (manager) => {
    const segments = await manager
      .createQueryBuilder(Segment, 'segment')
      .setLock('pessimistic_write')
      .where('segment.media_id = :mediaId', { mediaId })
      .andWhere('segment.episode = :episodeNumber', { episodeNumber })
      .orderBy('segment.position', 'ASC')
      .getMany();

    if (segments.length === 0) {
      throw new NotFoundError(`Episode ${episodeNumber} has no segments`);
    }

    if (segments.length > body.maxAffected) {
      throw new InvalidRequestError(
        `Episode has ${segments.length} segments, which exceeds maxAffected=${body.maxAffected}. ` +
          'Nothing was changed. Raise maxAffected only if you intend to review a change of that size.',
      );
    }

    for (const segment of segments) {
      const snapshot = toSegmentSnapshot(segment);

      if (body.action === 'shiftTimings') {
        const offsetMs = body.offsetMs as number;
        // Clamp shifted times at zero rather than skipping a segment; every line must remain aligned with the episode.
        segment.startTimeMs = Math.max(0, segment.startTimeMs + offsetMs);
        segment.endTimeMs = Math.max(0, segment.endTimeMs + offsetMs);
      } else {
        segment.status = body.status as SegmentStatus;
      }

      await manager.save(segment);
      await createSegmentRevision(manager, segment.id, snapshot, provenance);
    }

    return segments.length;
  });
}

export async function createSegmentRevision(
  manager: EntityManager,
  segmentId: number,
  snapshot: Record<string, unknown>,
  provenance: RevisionProvenance,
): Promise<void> {
  const row = await manager
    .createQueryBuilder(SegmentRevision, 'r')
    .select('COALESCE(MAX(r.revision_number), 0)', 'max')
    .where('r.segment_id = :segmentId', { segmentId })
    .getRawOne<{ max: number }>();
  const max = row?.max ?? 0;

  const revision = SegmentRevision.create({
    segmentId,
    revisionNumber: max + 1,
    snapshot,
    userId: provenance.userId,
    actor: provenance.actor,
    reportId: provenance.reportId,
  });
  await manager.save(revision);
}
