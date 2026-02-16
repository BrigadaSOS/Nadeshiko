import type {
  SegmentIndex,
  SegmentCreate,
  SegmentShow,
  SegmentUpdate,
  SegmentDestroy,
  SegmentShowByUuid,
  SegmentContextShow,
} from 'generated/routes/media';
import { v3 as uuidv3 } from 'uuid';
import { config } from '@config/config';
import { Segment, Episode, Media, SegmentStorage, SegmentStatus, ContentRating } from '@app/models';
import { toSegmentDTO, toSegmentInternalDTO, toSegmentListDTO } from './mappers/segment.mapper';
import { querySurroundingSegments } from '@app/services/elasticsearch';

export const segmentIndex: SegmentIndex = async ({ params, query }, respond) => {
  await Episode.findOneOrFail({ where: { mediaId: params.mediaId, episodeNumber: params.episodeNumber } });

  const [segments, count] = await Segment.findAndCount({
    where: { mediaId: params.mediaId, episode: params.episodeNumber },
    order: { id: 'ASC' },
    take: query.limit,
    skip: query.cursor,
  });

  const nextCursor = query.cursor + count;
  const hasMore = count === query.limit;

  return respond.with200().body({
    segments: toSegmentListDTO(segments),
    pagination: {
      hasMore,
      cursor: hasMore ? nextCursor : null,
    },
  });
};

export const segmentCreate: SegmentCreate = async ({ params, body }, respond) => {
  await Episode.findOneOrFail({ where: { mediaId: params.mediaId, episodeNumber: params.episodeNumber } });

  const media = await Media.findOneOrFail({ where: { id: params.mediaId } });

  const uniqueBaseId = `${params.mediaId}-1-${params.episodeNumber}-${body.position}`;
  const uuid = uuidv3(uniqueBaseId, config.UUID_NAMESPACE);

  const jaContent = body.textJa?.content ?? '';

  const segment = Segment.create({
    mediaId: params.mediaId,
    storageBasePath: media.storageBasePath,
    uuid,
    position: body.position,
    status: body.status as SegmentStatus,
    startTimeMs: body.startTimeMs,
    endTimeMs: body.endTimeMs,
    contentJa: jaContent,
    contentEs: body.textEs?.content,
    contentEsMt: body.textEs?.isMachineTranslated ?? false,
    contentEn: body.textEn?.content,
    contentEnMt: body.textEn?.isMachineTranslated ?? false,
    contentRating: (body.contentRating ?? ContentRating.SAFE) as ContentRating,
    ratingAnalysis: body.ratingAnalysis,
    posAnalysis: body.posAnalysis,
    storage: body.storage as SegmentStorage,
    hashedId: body.hashedId,
    episode: params.episodeNumber,
  });

  await segment.save();

  return respond.with201().body(toSegmentInternalDTO(segment));
};

export const segmentShow: SegmentShow = async ({ params }, respond) => {
  const segment = await Segment.findOneOrFail({
    where: {
      id: params.id,
      mediaId: params.mediaId,
      episode: params.episodeNumber,
    },
  });

  return respond.with200().body(toSegmentDTO(segment));
};

export const segmentUpdate: SegmentUpdate = async ({ params, body }, respond) => {
  const segment = await Segment.findOneOrFail({
    where: { id: params.id as number },
  });

  // Unpack nested body into flat entity fields
  if (body.textJa?.content !== undefined) {
    segment.contentJa = body.textJa.content;
  }
  if (body.textEn?.content !== undefined) segment.contentEn = body.textEn.content;
  if (body.textEn?.isMachineTranslated !== undefined) segment.contentEnMt = body.textEn.isMachineTranslated;
  if (body.textEs?.content !== undefined) segment.contentEs = body.textEs.content;
  if (body.textEs?.isMachineTranslated !== undefined) segment.contentEsMt = body.textEs.isMachineTranslated;
  if (body.status !== undefined) segment.status = body.status as any;
  if (body.storage !== undefined) segment.storage = body.storage as any;
  if (body.startTimeMs !== undefined) segment.startTimeMs = body.startTimeMs;
  if (body.endTimeMs !== undefined) segment.endTimeMs = body.endTimeMs;
  if (body.position !== undefined) segment.position = body.position;
  if (body.contentRating !== undefined) segment.contentRating = body.contentRating as ContentRating;
  if (body.ratingAnalysis !== undefined) segment.ratingAnalysis = body.ratingAnalysis;
  if (body.posAnalysis !== undefined) segment.posAnalysis = body.posAnalysis;
  if (body.hashedId !== undefined) segment.hashedId = body.hashedId;

  await segment.save();

  return respond.with200().body(toSegmentInternalDTO(segment));
};

export const segmentDestroy: SegmentDestroy = async ({ params }, respond) => {
  const segment = await Segment.findOneOrFail({
    where: {
      id: params.id,
      mediaId: params.mediaId,
      episode: params.episodeNumber,
    },
  });

  await segment.softRemove();

  return respond.with204();
};

export const segmentShowByUuid: SegmentShowByUuid = async ({ params }, respond) => {
  const segment = await Segment.findOneOrFail({
    where: { uuid: params.uuid },
  });

  return respond.with200().body(toSegmentDTO(segment));
};

export const segmentContextShow: SegmentContextShow = async ({ params, query }, respond) => {
  const segment = await Segment.findOneOrFail({
    where: { uuid: params.uuid },
  });

  const searchResults = await querySurroundingSegments({
    mediaId: segment.mediaId,
    episodeNumber: segment.episode,
    segmentPosition: segment.position,
    limit: query.limit || 3,
    contentRating: query.contentRating,
  });

  const includeMedia = query.include?.includes('media') ?? false;
  const response = includeMedia ? searchResults : { ...searchResults, includes: { media: {} } };
  return respond.with200().body(response);
};
