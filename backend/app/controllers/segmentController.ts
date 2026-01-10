import type {
  SegmentIndex,
  SegmentCreate,
  SegmentShow,
  SegmentUpdate,
  SegmentDestroy,
  SegmentShowByUuid,
} from 'generated/routes/media';
import type { DeepPartial } from 'typeorm';
import { Segment, Episode } from '@app/entities';
import { toSegmentDTO, toSegmentListDTO } from './mappers/segment.mapper';
import { updateEpisodeSegmentCount } from '@app/utils/updateSegmentCounts';

export const segmentIndex: SegmentIndex = async ({ params, query }, respond) => {
  await Episode.findOneOrFail({ where: { mediaId: params.mediaId, episodeNumber: params.episodeNumber } });

  const [segments, count] = await Segment.findAndCount({
    where: { mediaId: params.mediaId, episode: params.episodeNumber },
    order: { id: 'ASC' },
    take: query.size,
    skip: query.cursor,
  });

  const nextCursor = query.cursor + count;
  const hasMoreResults = count === query.size;

  return respond.with200().body({
    data: toSegmentListDTO(segments),
    cursor: hasMoreResults ? nextCursor : undefined,
    hasMoreResults,
  });
};

export const segmentCreate: SegmentCreate = async ({ params, body }, respond) => {
  await Episode.findOneOrFail({ where: { mediaId: params.mediaId, episodeNumber: params.episodeNumber } });

  const segment = Segment.create({
    mediaId: params.mediaId,
    uuid: body.uuid,
    position: body.position,
    status: body.status,
    startTime: body.startTime,
    endTime: body.endTime,
    content: body.content,
    contentLength: body.content.length,
    contentSpanish: body.contentSpanish,
    contentSpanishMt: body.contentSpanishMt,
    contentEnglish: body.contentEnglish,
    contentEnglishMt: body.contentEnglishMt,
    isNsfw: body.isNsfw,
    storage: body.storage,
    hashedId: body.hashedId,
    actorJa: body.actorJa,
    actorEs: body.actorEs,
    actorEn: body.actorEn,
    episode: params.episodeNumber,
  });

  await segment.save();

  await updateEpisodeSegmentCount(params.mediaId, params.episodeNumber);

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

  // Handle contentLength special case before merge
  if (body.content !== undefined) {
    segment.contentLength = body.content.length;
  }

  Segment.merge(segment, body as DeepPartial<Segment>);
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

  await updateEpisodeSegmentCount(params.mediaId, params.episodeNumber);

  return respond.with204();
};

export const segmentShowByUuid: SegmentShowByUuid = async ({ params }, respond) => {
  const segment = await Segment.findOneOrFail({
    where: { uuid: params.uuid },
  });

  return respond.with200().body(toSegmentDTO(segment));
};
