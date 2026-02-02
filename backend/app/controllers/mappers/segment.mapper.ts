import type { t_Segment } from 'generated/models';
import type { Segment } from '@app/entities';

export const toSegmentDTO = (segment: Segment): t_Segment => ({
  id: segment.id,
  uuid: segment.uuid,
  position: segment.position,
  status: segment.status,
  startTime: segment.startTime,
  endTime: segment.endTime,
  content: segment.content,
  contentLength: segment.contentLength,
  contentSpanish: segment.contentSpanish,
  contentSpanishMt: segment.contentSpanishMt,
  contentEnglish: segment.contentEnglish,
  contentEnglishMt: segment.contentEnglishMt,
  isNsfw: segment.isNsfw,
  imageUrl: segment.imageUrl,
  audioUrl: segment.audioUrl,
  actorJa: segment.actorJa,
  actorEs: segment.actorEs,
  actorEn: segment.actorEn,
  episode: segment.episode,
  mediaId: segment.mediaId,
});

export const toSegmentListDTO = (segments: Segment[]): t_Segment[] => segments.map(toSegmentDTO);
