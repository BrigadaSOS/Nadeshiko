import type {
  SegmentIndex,
  SegmentCreate,
  SegmentShow,
  SegmentUpdate,
  SegmentDestroy,
  SegmentShowByUuid,
} from 'generated/routes/media';
import { v3 as uuidv3 } from 'uuid';
import { config } from '@config/config';
import { Segment, Episode } from '@app/models';
import { toSegmentDTO, toSegmentListDTO } from './mappers/segment.mapper';

export const segmentIndex: SegmentIndex = async ({ params, query }, respond) => {
  await Episode.findOneOrFail({ where: { mediaId: params.mediaId, episodeNumber: params.episodeNumber } });

  const [segments, count] = await Segment.findAndCount({
    where: { mediaId: params.mediaId, episode: params.episodeNumber },
    order: { id: 'ASC' },
    take: query.size,
    skip: query.cursor,
  });

  const nextCursor = query.cursor + count;
  const hasMore = count === query.size;

  return respond.with200().body({
    data: toSegmentListDTO(segments),
    cursor: hasMore ? nextCursor : undefined,
    hasMore,
  });
};

export const segmentCreate: SegmentCreate = async ({ params, body }, respond) => {
  await Episode.findOneOrFail({ where: { mediaId: params.mediaId, episodeNumber: params.episodeNumber } });

  const uniqueBaseId = `${params.mediaId}-1-${params.episodeNumber}-${body.position}`;
  const uuid = uuidv3(uniqueBaseId, config.UUID_NAMESPACE);

  const jaContent = body.ja?.content ?? '';

  const segment = Segment.create({
    mediaId: params.mediaId,
    uuid,
    position: body.position,
    status: body.status,
    startTime: body.startTime,
    endTime: body.endTime,
    contentJa: jaContent,
    characterCount: jaContent.length,
    contentEs: body.es?.content,
    contentEsMt: body.es?.isMachineTranslated ?? false,
    contentEn: body.en?.content,
    contentEnMt: body.en?.isMachineTranslated ?? false,
    isNsfw: body.isNsfw,
    storage: body.storage,
    hashedId: body.hashedId,
    episode: params.episodeNumber,
  });

  await segment.save();

  return respond.with201().body(toSegmentDTO(segment));
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
  if (body.ja?.content !== undefined) {
    segment.contentJa = body.ja.content;
    segment.characterCount = body.ja.content.length;
  }
  if (body.en?.content !== undefined) segment.contentEn = body.en.content;
  if (body.en?.isMachineTranslated !== undefined) segment.contentEnMt = body.en.isMachineTranslated;
  if (body.es?.content !== undefined) segment.contentEs = body.es.content;
  if (body.es?.isMachineTranslated !== undefined) segment.contentEsMt = body.es.isMachineTranslated;
  if (body.status !== undefined) segment.status = body.status as any;
  if (body.storage !== undefined) segment.storage = body.storage as any;
  if (body.startTime !== undefined) segment.startTime = body.startTime;
  if (body.endTime !== undefined) segment.endTime = body.endTime;
  if (body.position !== undefined) segment.position = body.position;
  if (body.isNsfw !== undefined) segment.isNsfw = body.isNsfw;
  if (body.hashedId !== undefined) segment.hashedId = body.hashedId;

  await segment.save();

  return respond.with200().body(toSegmentDTO(segment));
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
