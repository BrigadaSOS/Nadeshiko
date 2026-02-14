import type { t_Segment } from 'generated/models';
import type { Segment } from '@app/models';
import { getSegmentImageUrl, getSegmentAudioUrl, getSegmentVideoUrl } from '@lib/utils/storage';

export const toSegmentDTO = (segment: Segment): t_Segment => ({
  id: segment.id,
  uuid: segment.uuid,
  position: segment.position,
  status: segment.status as t_Segment['status'],
  startTime: segment.startTime,
  endTime: segment.endTime,
  ja: {
    content: segment.contentJa,
    characterCount: segment.characterCount,
  },
  en: {
    content: segment.contentEn || null,
    isMachineTranslated: segment.contentEnMt,
  },
  es: {
    content: segment.contentEs || null,
    isMachineTranslated: segment.contentEsMt,
  },
  isNsfw: segment.isNsfw,
  imageUrl: getSegmentImageUrl(segment),
  audioUrl: getSegmentAudioUrl(segment),
  videoUrl: getSegmentVideoUrl(segment),
  episode: segment.episode,
  mediaId: segment.mediaId,
  storage: segment.storage as t_Segment['storage'],
  hashedId: segment.hashedId,
  morphemes: segment.morphemes ?? undefined,
});

export const toSegmentListDTO = (segments: Segment[]): t_Segment[] => segments.map(toSegmentDTO);
