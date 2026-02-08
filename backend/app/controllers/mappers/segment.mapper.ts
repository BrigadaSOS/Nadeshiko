import type { t_Segment } from 'generated/models';
import type { Segment } from '@app/entities';
import { getSegmentImageUrl, getSegmentAudioUrl, getSegmentVideoUrl } from '@lib/utils/storage';

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
  imageUrl: getSegmentImageUrl(segment),
  audioUrl: getSegmentAudioUrl(segment),
  videoUrl: getSegmentVideoUrl(segment),
  actorJa: segment.actorJa,
  actorEs: segment.actorEs,
  actorEn: segment.actorEn,
  episode: segment.episode,
  mediaId: segment.mediaId,
  storage: segment.storage,
  hashedId: segment.hashedId,
});

export const toSegmentListDTO = (segments: Segment[]): t_Segment[] => segments.map(toSegmentDTO);
