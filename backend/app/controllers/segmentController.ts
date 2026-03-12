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

  const { items: segments, pagination } = await Segment.paginateWithOffset({
    take: query.take,
    cursor: query.cursor,
    exists: {
      entity: Episode,
      where: { mediaId: media.id, episodeNumber: params.episodeNumber },
    },
    find: {
      where: { mediaId: media.id, episode: params.episodeNumber },
      order: { id: 'ASC' },
    },
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

  const result = await Segment.createQueryBuilder().insert().into(Segment).values(attributes).orIgnore().execute();

  const created = result.identifiers.filter((id) => id?.id !== undefined).length;
  const skipped = attributes.length - created;

  if (created > 0) {
    const createdIds = result.identifiers.filter((id) => id?.id !== undefined).map((id) => id.id as number);

    sendBulkEsSyncJobs(createdIds.map((segmentId) => ({ segmentId, operation: 'CREATE' as const }))).catch((error) => {
      logger.error({ err: error }, 'Failed to enqueue bulk ES sync jobs for batch segment creation');
    });

    Cache.invalidate(MEDIA_INFO_CACHE);
  }

  return respond.with201().body({ created, skipped });
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
  const { max } = await SegmentRevision.createQueryBuilder('r')
    .select('COALESCE(MAX(r.revision_number), 0)', 'max')
    .where('r.segment_id = :segmentId', { segmentId })
    .getRawOne<{ max: number }>();

  const revision = SegmentRevision.create({
    segmentId,
    revisionNumber: max + 1,
    snapshot,
    userId,
  });
  await revision.save();
}
