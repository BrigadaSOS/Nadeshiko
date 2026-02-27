import type { t_Segment, t_SegmentInternal, t_SegmentRevision } from 'generated/models';
import type { SegmentCreateRequestOutput, SegmentUpdateRequestOutput } from 'generated/outputTypes';
import type { Segment } from '@app/models';
import type { SegmentRevision } from '@app/models/SegmentRevision';
import { ContentRating, SegmentStatus, SegmentStorage } from '@app/models/Segment';
import { getSegmentImageUrl, getSegmentAudioUrl, getSegmentVideoUrl } from '@lib/utils/storage';
import { config } from '@config/config';
import { v3 as uuidv3 } from 'uuid';

const toJsonObjectOrNull = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' ? (value as Record<string, unknown>) : null;

export const toSegmentDTO = (segment: Segment): t_Segment => {
  const imageUrl = getSegmentImageUrl(segment);
  const audioUrl = getSegmentAudioUrl(segment);
  const videoUrl = getSegmentVideoUrl(segment);

  return {
    id: segment.id,
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

export const toSegmentInternalDTO = (segment: Segment, include?: string[]): t_SegmentInternal => {
  const all = include === undefined;
  return {
    ...toSegmentDTO(segment),
    storage: all || include.includes('storage') ? (segment.storage as t_SegmentInternal['storage']) : null,
    hashedId: all || include.includes('hashedId') ? segment.hashedId : null,
    storageBasePath: all || include.includes('storageBasePath') ? segment.storageBasePath : null,
    ratingAnalysis: all || include.includes('ratingAnalysis') ? toJsonObjectOrNull(segment.ratingAnalysis) : null,
    posAnalysis: all || include.includes('posAnalysis') ? toJsonObjectOrNull(segment.posAnalysis) : null,
  };
};

export const toSegmentListDTO = (segments: Segment[]): t_Segment[] => segments.map(toSegmentDTO);

export const toSegmentInternalListDTO = (segments: Segment[]): t_SegmentInternal[] =>
  segments.map((s) => toSegmentInternalDTO(s));

type SegmentCreateAttributesInput = {
  mediaId: number;
  episodeNumber: number;
  storageBasePath: string;
  body: SegmentCreateRequestOutput;
};

export function toSegmentCreateAttributes(input: SegmentCreateAttributesInput): Partial<Segment> {
  const { mediaId, episodeNumber, storageBasePath, body } = input;
  const uniqueBaseId = `${mediaId}-1-${episodeNumber}-${body.position}`;

  return {
    mediaId,
    storageBasePath,
    uuid: uuidv3(uniqueBaseId, config.UUID_NAMESPACE),
    position: body.position,
    status: body.status as SegmentStatus,
    startTimeMs: body.startTimeMs,
    endTimeMs: body.endTimeMs,
    contentJa: body.textJa?.content ?? '',
    contentEs: body.textEs?.content ?? '',
    contentEsMt: body.textEs?.isMachineTranslated ?? false,
    contentEn: body.textEn?.content ?? '',
    contentEnMt: body.textEn?.isMachineTranslated ?? false,
    contentRating: (body.contentRating ?? ContentRating.SAFE) as ContentRating,
    ratingAnalysis: body.ratingAnalysis ?? { scores: {}, tags: {} },
    posAnalysis: body.posAnalysis ?? { nouns: 0 },
    storage: body.storage as SegmentStorage,
    hashedId: body.hashedId,
    episode: episodeNumber,
  };
}

export function toSegmentSnapshot(segment: Segment): Record<string, unknown> {
  return {
    contentJa: segment.contentJa,
    contentEn: segment.contentEn,
    contentEnMt: segment.contentEnMt,
    contentEs: segment.contentEs,
    contentEsMt: segment.contentEsMt,
    status: segment.status,
    contentRating: segment.contentRating,
    position: segment.position,
    startTimeMs: segment.startTimeMs,
    endTimeMs: segment.endTimeMs,
    ratingAnalysis: toJsonObjectOrNull(segment.ratingAnalysis),
    posAnalysis: toJsonObjectOrNull(segment.posAnalysis),
  };
}

export function toSegmentRevisionDTO(revision: SegmentRevision, userName: string | null): t_SegmentRevision {
  return {
    id: revision.id,
    revisionNumber: revision.revisionNumber,
    snapshot: revision.snapshot,
    userName,
    createdAt: revision.createdAt.toISOString(),
  };
}

export function toSegmentUpdatePatch(body: SegmentUpdateRequestOutput): Partial<Segment> {
  const mappedPatch: Partial<Record<keyof Segment, unknown>> = {
    contentJa: body.textJa?.content,
    contentEn: body.textEn?.content,
    contentEnMt: body.textEn?.isMachineTranslated,
    contentEs: body.textEs?.content,
    contentEsMt: body.textEs?.isMachineTranslated,
    status: body.status as SegmentStatus | undefined,
    storage: body.storage as SegmentStorage | undefined,
    startTimeMs: body.startTimeMs,
    endTimeMs: body.endTimeMs,
    position: body.position,
    contentRating: body.contentRating as ContentRating | undefined,
    ratingAnalysis: body.ratingAnalysis,
    posAnalysis: body.posAnalysis,
    hashedId: body.hashedId,
  };

  return Object.fromEntries(Object.entries(mappedPatch).filter(([, value]) => value !== undefined)) as Partial<Segment>;
}
