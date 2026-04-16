import type {
  ListSegments,
  CreateSegment,
  CreateSegmentsBatch,
  GetSegment,
  UpdateSegment,
  DeleteSegment,
  GetSegmentByUuid,
  GetSegmentContext,
  UpdateSegmentByUuid,
  ListSegmentRevisions,
} from 'generated/routes/media';
import { Segment, Episode, Media, SegmentStatus, SegmentRevision, ExternalSourceType } from '@app/models';
import { MEDIA_INFO_CACHE } from '@app/models/Media';
import {
  toSegmentCreateAttributes,
  toSegmentDTO,
  toSegmentInternalDTO,
  toSegmentListDTO,
  toSegmentSnapshot,
  toSegmentRevisionDTO,
  toSegmentUpdatePatch,
} from './mappers/segment.mapper';
import { SegmentDocument } from '@app/models/SegmentDocument';
import { sendBulkEsSyncJobs } from '@app/workers/esSyncQueue';
import { Cache } from '@lib/cache';
import { logger } from '@config/log';
import { assertUser } from '@app/middleware/authentication';
import { InvalidRequestError, NotFoundError } from '@app/errors';

export const listSegments: ListSegments = async ({ params, query }, respond) => {
  const media = await Media.findOneOrFail({ where: { publicId: params.mediaId } });

  const { items: segments, pagination } = await Segment.paginateWithKeyset({
    take: query.take,
    cursor: query.cursor,
    orderBy: { column: 'id', direction: 'ASC' },
    exists: {
      entity: Episode,
      where: { mediaId: media.id, episodeNumber: params.episodeNumber },
    },
    query: () =>
      Segment.createQueryBuilder('segment')
        .where('segment.mediaId = :mediaId AND segment.episode = :episode', {
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
  const media = await Media.findOneOrFail({ where: { publicId: params.mediaId }, relations: ['externalIds'] });

  const segment = Segment.create(
    toSegmentCreateAttributes({
      mediaId: media.id,
      anilistId: getPrimaryExternalId(media),
      airingFormat: media.airingFormat,
      episodeNumber: params.episodeNumber,
      storageBasePath: media.storageBasePath,
      body,
    }),
  ) as Segment;
  await segment.save();

  return respond.with201().body(toSegmentInternalDTO(segment, undefined, media.publicId));
};

export const createSegmentsBatch: CreateSegmentsBatch = async ({ params, body }, respond) => {
  const media = await Media.findOneOrFail({ where: { publicId: params.mediaId }, relations: ['externalIds'] });

  const anilistId = getPrimaryExternalId(media);
  const attributes = body.segments.map((segmentBody) =>
    toSegmentCreateAttributes({
      mediaId: media.id,
      anilistId,
      airingFormat: media.airingFormat,
      episodeNumber: params.episodeNumber,
      storageBasePath: media.storageBasePath,
      body: segmentBody,
    }),
  );

  // Upsert: insert new segments, or reactivate DELETED/HIDDEN ones with updated content.
  // This allows reprocessing an episode without needing to hard-delete first —
  // segments with the same UUID (same anime + episode + position) get their content replaced.
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
        'pos_analysis',
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

    Cache.invalidate(MEDIA_INFO_CACHE);
  }

  return respond.with201().body({ created: allIds.length, skipped: attributes.length - allIds.length });
};

export const getSegment: GetSegment = async ({ params }, respond) => {
  const media = await Media.findOneOrFail({ where: { publicId: params.mediaId } });

  const segment = await Segment.findOneOrFail({
    where: {
      id: params.id,
      mediaId: media.id,
      episode: params.episodeNumber,
    },
  });

  return respond.with200().body(toSegmentDTO(segment, media.publicId));
};

export const updateSegment: UpdateSegment = async ({ params, body }, respond, req) => {
  const media = await Media.findOneOrFail({ where: { publicId: params.mediaId } });

  const segment = await Segment.findOneOrFail({
    where: {
      id: params.id,
      mediaId: media.id,
      episode: params.episodeNumber,
    },
  });

  const snapshot = toSegmentSnapshot(segment);
  const userId = assertUser(req).id;

  Object.assign(segment, toSegmentUpdatePatch(body));
  await segment.save();

  createSegmentRevision(segment.id, snapshot, userId).catch((err) => {
    logger.error({ err }, 'Failed to create segment revision');
  });

  return respond.with200().body(toSegmentInternalDTO(segment, undefined, media.publicId));
};

export const deleteSegment: DeleteSegment = async ({ params }, respond) => {
  const media = await Media.findOneOrFail({ where: { publicId: params.mediaId } });

  await Segment.findAndUpdateOrFail({
    where: {
      id: params.id,
      mediaId: media.id,
      episode: params.episodeNumber,
    },
    patch: {
      status: SegmentStatus.DELETED,
    },
  });

  return respond.with204();
};

export const updateSegmentByUuid: UpdateSegmentByUuid = async ({ params, body }, respond, req) => {
  const { segment, mediaPublicId } = await findSegmentByUuidOrPublicId(params.uuid);

  const snapshot = toSegmentSnapshot(segment);
  const userId = assertUser(req).id;

  Object.assign(segment, toSegmentUpdatePatch(body));
  await segment.save();

  createSegmentRevision(segment.id, snapshot, userId).catch((err) => {
    logger.error({ err }, 'Failed to create segment revision');
  });

  return respond.with200().body(toSegmentInternalDTO(segment, undefined, mediaPublicId));
};

export const getSegmentByUuid: GetSegmentByUuid = async ({ params, query }, respond) => {
  const { segment, mediaPublicId } = await findSegmentByUuidOrPublicId(params.uuid);

  return respond.with200().body(toSegmentInternalDTO(segment, query.include ?? [], mediaPublicId));
};

export const listSegmentRevisions: ListSegmentRevisions = async ({ params }, respond) => {
  const { segment } = await findSegmentByUuidOrPublicId(params.uuid);

  const revisions = await SegmentRevision.find({
    where: { segmentId: segment.id },
    relations: ['user'],
    order: { revisionNumber: 'DESC' },
  });

  return respond.with200().body({
    revisions: revisions.map((r) => toSegmentRevisionDTO(r, r.user?.username ?? null)),
  });
};

export const getSegmentContext: GetSegmentContext = async ({ params, query }, respond) => {
  const { segment } = await findSegmentByUuidOrPublicId(params.uuid);

  const searchResults = await SegmentDocument.surroundingSegments({
    mediaId: segment.mediaId,
    episodeNumber: segment.episode,
    segmentPosition: segment.position,
    limit: query.take || 3,
    contentRating: query.contentRating,
  });

  return respond.with200().body(searchResults);
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
  const media = await Media.findOneOrFail({ where: { id: segment.mediaId }, select: ['publicId'] });
  return { segment, mediaPublicId: media.publicId };
}

function getPrimaryExternalId(media: Media): string {
  const preferred = [
    ExternalSourceType.ANILIST,
    ExternalSourceType.TMDB,
    ExternalSourceType.TVDB,
    ExternalSourceType.IMDB,
  ];
  for (const source of preferred) {
    const ext = media.externalIds?.find((e) => e.source === source);
    if (ext) return ext.externalId;
  }
  throw new InvalidRequestError(`Media ${media.id} is missing an external ID (AniList, TMDB, etc.)`);
}

async function createSegmentRevision(
  segmentId: number,
  snapshot: Record<string, unknown>,
  userId: number,
): Promise<void> {
  const row = await SegmentRevision.createQueryBuilder('r')
    .select('COALESCE(MAX(r.revision_number), 0)', 'max')
    .where('r.segment_id = :segmentId', { segmentId })
    .getRawOne<{ max: number }>();
  const max = row?.max ?? 0;

  const revision = SegmentRevision.create({
    segmentId,
    revisionNumber: max + 1,
    snapshot,
    userId,
  });
  await revision.save();
}
