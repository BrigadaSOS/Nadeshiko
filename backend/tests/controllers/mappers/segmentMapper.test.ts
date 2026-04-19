import { describe, it, expect } from 'bun:test';
import {
  toSegmentCreateAttributes,
  toSegmentDTO,
  toSegmentInternalDTO,
  toSegmentListDTO,
  toSegmentInternalListDTO,
  toSegmentUpdatePatch,
} from '@app/controllers/mappers/segmentMapper';
import { ContentRating, SegmentStatus, SegmentStorage } from '@app/models/Segment';
import { v3 as uuidv3 } from 'uuid';
import { config } from '@config/config';

function buildSegment(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    uuid: 'seg-1',
    publicId: 'seg-pid-1',
    position: 5,
    status: SegmentStatus.ACTIVE,
    startTimeMs: 10,
    endTimeMs: 20,
    contentJa: 'ja',
    contentEn: 'en',
    contentEnMt: false,
    contentEs: 'es',
    contentEsMt: true,
    contentRating: ContentRating.SAFE,
    episode: 3,
    mediaId: 99,
    storage: SegmentStorage.R2,
    hashedId: 'hash1',
    storageBasePath: 'media/path',
    ratingAnalysis: { score: 0.9 },
    posAnalysis: { nouns: 1 },
    ...overrides,
  };
}

describe('segment.mapper', () => {
  it('maps segment urls when hashedId is present', () => {
    const dto = toSegmentDTO(buildSegment() as any);
    expect(dto.urls.imageUrl).toContain('/media/path/3/hash1.webp');
    expect(dto.urls.audioUrl).toContain('/media/path/3/hash1.mp3');
    expect(dto.urls.videoUrl).toContain('/media/path/3/hash1.mp4');
  });

  it('maps segment urls for LOCAL storage', () => {
    const dto = toSegmentDTO(
      buildSegment({
        storage: SegmentStorage.LOCAL,
        storageBasePath: 'local/path',
        hashedId: 'local-hash',
      }) as any,
    );
    expect(dto.urls).toEqual({
      imageUrl: '/media/local/path/3/local-hash.webp',
      audioUrl: '/media/local/path/3/local-hash.mp3',
      videoUrl: '/media/local/path/3/local-hash.mp4',
    });
  });

  it('maps internal dto and normalizes non-object analyses to null', () => {
    const dto = toSegmentInternalDTO(buildSegment({ ratingAnalysis: 'bad', posAnalysis: null }) as any);
    expect(dto.storage).toBe('R2');
    expect(dto.hashedId).toBe('hash1');
    expect(dto.storageBasePath).toBe('media/path');
    expect(dto.ratingAnalysis).toBeNull();
    expect(dto.posAnalysis).toBeNull();
  });

  it('maps segment and internal segment lists', () => {
    const segments = [buildSegment({ id: 1 }), buildSegment({ id: 2, publicId: 'seg-pid-2' })];
    const list = toSegmentListDTO(segments as any);
    const internalList = toSegmentInternalListDTO(segments as any);

    expect(list).toHaveLength(2);
    expect(internalList).toHaveLength(2);
    expect(list[1].publicId).toBe('seg-pid-2');
    expect(internalList[0].storage).toBe('R2');
  });

  it('maps create attributes with deterministic uuid and defaults', () => {
    const attrs = toSegmentCreateAttributes({
      mediaId: 10,
      anilistId: '99999',
      airingFormat: 'TV',
      episodeNumber: 2,
      storageBasePath: '/anime/show',
      body: {
        position: 3,
        startTimeMs: 100,
        endTimeMs: 500,
        textJa: {},
        storage: 'R2',
        hashedId: 'h123',
      } as any,
    });

    expect(attrs.uuid).toBe(uuidv3('99999-1-2-3', config.UUID_NAMESPACE));
    expect(attrs.contentJa).toBe('');
    expect(attrs.contentEn).toBe('');
    expect(attrs.contentEs).toBe('');
    expect(attrs.contentEnMt).toBe(false);
    expect(attrs.contentEsMt).toBe(false);
    expect(attrs.contentRating).toBe(ContentRating.SAFE);
  });

  it('uses season 0 for MOVIE airing format in uuid', () => {
    const attrs = toSegmentCreateAttributes({
      mediaId: 10,
      anilistId: '99999',
      airingFormat: 'MOVIE',
      episodeNumber: 1,
      storageBasePath: '/anime/movie',
      body: {
        position: 3,
        startTimeMs: 100,
        endTimeMs: 500,
        textJa: {},
        storage: 'R2',
        hashedId: 'h123',
      } as any,
    });

    expect(attrs.uuid).toBe(uuidv3('99999-0-1-3', config.UUID_NAMESPACE));
  });

  it('maps update patch and keeps falsy values', () => {
    const patch = toSegmentUpdatePatch({
      textJa: { content: '' },
      textEn: { content: 'en2', isMachineTranslated: false },
      textEs: { content: 'es2', isMachineTranslated: false },
      status: 'VERIFIED',
      storage: 'LOCAL',
      startTimeMs: 0,
      endTimeMs: 0,
      position: 0,
      contentRating: 'QUESTIONABLE',
      ratingAnalysis: null,
      posAnalysis: null,
      hashedId: 'newhash',
    } as any);

    expect(patch).toMatchObject({
      contentJa: '',
      contentEn: 'en2',
      contentEnMt: false,
      contentEs: 'es2',
      contentEsMt: false,
      status: SegmentStatus.VERIFIED,
      storage: SegmentStorage.LOCAL,
      startTimeMs: 0,
      endTimeMs: 0,
      position: 0,
      contentRating: ContentRating.QUESTIONABLE,
      ratingAnalysis: null,
      posAnalysis: null,
      hashedId: 'newhash',
    });
  });

  it('does not set fields that are omitted in update input', () => {
    const patch = toSegmentUpdatePatch({
      textJa: { content: 'changed' },
    } as any);

    expect(patch).toEqual({
      contentJa: 'changed',
    });
  });
});
