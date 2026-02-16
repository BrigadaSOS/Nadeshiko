import type { t_Segment, t_SegmentInternal } from 'generated/models';
import type { Segment } from '@app/models';
import { getSegmentImageUrl, getSegmentAudioUrl, getSegmentVideoUrl } from '@lib/utils/storage';

const toJsonObjectOrNull = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' ? (value as Record<string, unknown>) : null;

export const toSegmentDTO = (segment: Segment): t_Segment => {
  const hasUrls = !!segment.hashedId;
  const imageUrl = hasUrls ? getSegmentImageUrl(segment) : '';
  const audioUrl = hasUrls ? getSegmentAudioUrl(segment) : '';
  const videoUrl = hasUrls ? getSegmentVideoUrl(segment) : '';

  return {
    uuid: segment.uuid,
    position: segment.position,
    status: segment.status as t_Segment['status'],
    startTimeMs: segment.startTimeMs,
    endTimeMs: segment.endTimeMs,
    textJa: {
      content: segment.contentJa,
    },
    textEn: {
      content: segment.contentEn,
      isMachineTranslated: segment.contentEnMt,
    },
    textEs: {
      content: segment.contentEs,
      isMachineTranslated: segment.contentEsMt,
    },
    contentRating: segment.contentRating as t_Segment['contentRating'],
    episode: segment.episode,
    mediaId: segment.mediaId,
    urls: {
      imageUrl,
      audioUrl,
      videoUrl,
    },
  };
};

export const toSegmentInternalDTO = (segment: Segment): t_SegmentInternal => ({
  ...toSegmentDTO(segment),
  storage: segment.storage as t_SegmentInternal['storage'],
  hashedId: segment.hashedId,
  storageBasePath: segment.storageBasePath,
  ratingAnalysis: toJsonObjectOrNull(segment.ratingAnalysis),
  posAnalysis: toJsonObjectOrNull(segment.posAnalysis),
});

export const toSegmentListDTO = (segments: Segment[]): t_Segment[] => segments.map(toSegmentDTO);

export const toSegmentInternalListDTO = (segments: Segment[]): t_SegmentInternal[] =>
  segments.map(toSegmentInternalDTO);
