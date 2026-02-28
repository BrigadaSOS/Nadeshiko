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
  const { items: segments, pagination } = await Segment.paginateWithOffset({
    take: query.take,
    cursor: query.cursor,
    exists: {
      entity: Episode,
      where: { mediaId: params.mediaId, episodeNumber: params.episodeNumber },
    },
    find: {
      where: { mediaId: params.mediaId, episode: params.episodeNumber },
      order: { id: 'ASC' },
    },
  });

  return respond.with200().body({
    segments: toSegmentListDTO(segments),
    pagination,
  });
};

export const createSegment: CreateSegment = async ({ params, body }, respond) => {
  const media = await Media.findOneOrFail({ where: { id: params.mediaId }, relations: ['externalIds'] });

  const segment = Segment.create(
    toSegmentCreateAttributes({
      mediaId: params.mediaId,
      anilistId: getAnilistId(media),
      airingFormat: media.airingFormat,
      episodeNumber: params.episodeNumber,
      storageBasePath: media.storageBasePath,
      body,
    }),
  ) as Segment;
  await segment.save();

  return respond.with201().body(toSegmentInternalDTO(segment));
};

export const createSegmentsBatch: CreateSegmentsBatch = async ({ params, body }, respond) => {
  const media = await Media.findOneOrFail({ where: { id: params.mediaId }, relations: ['externalIds'] });

  const anilistId = getAnilistId(media);
  const attributes = body.segments.map((segmentBody) =>
    toSegmentCreateAttributes({
      mediaId: params.mediaId,
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
  const segment = await Segment.findOneOrFail({
    where: {
      id: params.id,
      mediaId: params.mediaId,
      episode: params.episodeNumber,
    },
  });

  return respond.with200().body(toSegmentDTO(segment));
};

export const updateSegment: UpdateSegment = async ({ params, body }, respond, req) => {
  const segment = await Segment.findOneOrFail({
    where: {
      id: params.id,
      mediaId: params.mediaId,
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

  return respond.with200().body(toSegmentInternalDTO(segment));
};

export const deleteSegment: DeleteSegment = async ({ params }, respond) => {
  await Segment.findAndUpdateOrFail({
    where: {
      id: params.id,
      mediaId: params.mediaId,
      episode: params.episodeNumber,
    },
    patch: {
      status: SegmentStatus.DELETED,
    },
  });

  return respond.with204();
};

export const updateSegmentByUuid: UpdateSegmentByUuid = async ({ params, body }, respond, req) => {
  const segment = await findSegmentByUuidOrPublicId(params.uuid);

  const snapshot = toSegmentSnapshot(segment);
  const userId = assertUser(req).id;

  Object.assign(segment, toSegmentUpdatePatch(body));
  await segment.save();

  createSegmentRevision(segment.id, snapshot, userId).catch((err) => {
    logger.error({ err }, 'Failed to create segment revision');
  });

  return respond.with200().body(toSegmentInternalDTO(segment));
};

export const getSegmentByUuid: GetSegmentByUuid = async ({ params, query }, respond) => {
  const segment = await findSegmentByUuidOrPublicId(params.uuid);

  return respond.with200().body(toSegmentInternalDTO(segment, query.include ?? []));
};

export const listSegmentRevisions: ListSegmentRevisions = async ({ params }, respond) => {
  const segment = await findSegmentByUuidOrPublicId(params.uuid);

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
  const segment = await findSegmentByUuidOrPublicId(params.uuid);

  const searchResults = await SegmentDocument.surroundingSegments({
    mediaId: segment.mediaId,
    episodeNumber: segment.episode,
    segmentPosition: segment.position,
    limit: query.take || 3,
    contentRating: query.contentRating,
  });

  return respond.with200().body(searchResults);
};

async function findSegmentByUuidOrPublicId(idOrPublicId: string): Promise<Segment> {
  const where: Array<Partial<Pick<Segment, 'id' | 'uuid' | 'publicId'>>> = [
    { uuid: idOrPublicId },
    { publicId: idOrPublicId },
  ];

  const numericId = Number(idOrPublicId);
  if (Number.isInteger(numericId) && numericId > 0) {
    where.push({ id: numericId });
  }

  const segment = await Segment.findOne({ where });
  if (!segment) {
    throw new NotFoundError('Segment not found');
  }
  return segment;
}

function getAnilistId(media: Media): string {
  const anilist = media.externalIds?.find((e) => e.source === ExternalSourceType.ANILIST);
  if (!anilist) {
    throw new InvalidRequestError(`Media ${media.id} is missing an AniList external ID`);
  }
  return anilist.externalId;
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
