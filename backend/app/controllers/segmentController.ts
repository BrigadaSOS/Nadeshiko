import type {
  ListSegments,
  CreateSegment,
  GetSegment,
  UpdateSegment,
  DeleteSegment,
  GetSegmentByUuid,
  GetSegmentContext,
  UpdateSegmentByUuid,
} from 'generated/routes/media';
import { Segment, Episode, Media, SegmentStatus } from '@app/models';
import {
  toSegmentCreateAttributes,
  toSegmentDTO,
  toSegmentInternalDTO,
  toSegmentListDTO,
  toSegmentUpdatePatch,
} from './mappers/segment.mapper';
import { SegmentDocument } from '@app/models/SegmentDocument';

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
  const media = await Media.findOneOrFail({ where: { id: params.mediaId } });

  const segment = Segment.create(
    toSegmentCreateAttributes({
      mediaId: params.mediaId,
      episodeNumber: params.episodeNumber,
      storageBasePath: media.storageBasePath,
      body,
    }),
  ) as Segment;
  await segment.save();

  return respond.with201().body(toSegmentInternalDTO(segment));
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

export const updateSegment: UpdateSegment = async ({ params, body }, respond) => {
  const segment = await Segment.findAndUpdateOrFail({
    where: {
      id: params.id,
      mediaId: params.mediaId,
      episode: params.episodeNumber,
    },
    patch: toSegmentUpdatePatch(body),
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

export const updateSegmentByUuid: UpdateSegmentByUuid = async ({ params, body }, respond) => {
  const segment = await Segment.findAndUpdateOrFail({
    where: { uuid: params.uuid },
    patch: toSegmentUpdatePatch(body),
  });

  return respond.with200().body(toSegmentInternalDTO(segment));
};

export const getSegmentByUuid: GetSegmentByUuid = async ({ params, query }, respond) => {
  const segment = await Segment.findOneOrFail({
    where: { uuid: params.uuid },
  });

  return respond.with200().body(toSegmentInternalDTO(segment, query.include ?? []));
};

export const getSegmentContext: GetSegmentContext = async ({ params, query }, respond) => {
  const segment = await Segment.findOneOrFail({
    where: { uuid: params.uuid },
  });

  const searchResults = await SegmentDocument.surroundingSegments({
    mediaId: segment.mediaId,
    episodeNumber: segment.episode,
    segmentPosition: segment.position,
    limit: query.take || 3,
    contentRating: query.contentRating,
  });

  return respond.with200().body(searchResults);
};
