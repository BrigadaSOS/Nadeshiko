import { describe, it, expect, beforeEach, vi, spyOn } from 'bun:test';
import { setupTestSuite } from '../helpers/setup';
import { loadFixtures, type LoadedFixtures } from '../fixtures/loader';
import { Segment, SegmentStatus } from '@app/models/Segment';
import { Cache } from '@lib/cache';
import { MEDIA_INFO_CACHE } from '@app/models/Media';
import { setBossInstance } from '@app/workers/pgBossClient';

setupTestSuite();

let fixtures: LoadedFixtures;
let invalidateSpy: ReturnType<typeof spyOn>;
let mockSendDebounced: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  fixtures = await loadFixtures(['mediaWithEpisode']);
  mockSendDebounced = vi.fn().mockResolvedValue('mock-job-id');
  setBossInstance({ sendDebounced: mockSendDebounced } as any);
  invalidateSpy = spyOn(Cache, 'invalidate');
});

function buildSegment(overrides: Partial<Segment> = {}): Segment {
  const media = fixtures.media.testShow;
  const episode = fixtures.episodes.pilot;

  return Object.assign(new Segment(), {
    uuid: `test-${Date.now()}-${Math.random()}`,
    position: 1,
    status: SegmentStatus.ACTIVE,
    startTimeMs: 0,
    endTimeMs: 5000,
    contentJa: 'テスト',
    contentEs: 'Prueba',
    contentEn: 'Test',
    contentEsMt: false,
    contentEnMt: false,
    contentRating: 'SAFE',
    ratingAnalysis: { scores: {}, tags: {} },
    posAnalysis: { nouns: 0 },
    storage: 'R2',
    hashedId: `hashed-${Date.now()}`,
    mediaId: media.id,
    episode: episode.episodeNumber,
    storageBasePath: '/test',
    ...overrides,
  });
}

describe('SegmentSubscriber', () => {
  describe('afterInsert', () => {
    it('invalidates media cache and enqueues CREATE sync job', async () => {
      const segment = await buildSegment().save();

      expect(invalidateSpy).toHaveBeenCalledWith(MEDIA_INFO_CACHE);
      expect(mockSendDebounced).toHaveBeenCalledWith(
        'es-sync-create',
        { segmentId: segment.id, operation: 'CREATE' },
        null,
        1,
        `${segment.id}`,
      );
    });
  });

  describe('afterUpdate', () => {
    it('invalidates cache when status changes', async () => {
      const segment = await buildSegment().save();
      invalidateSpy.mockClear();
      mockSendDebounced.mockClear();

      segment.status = SegmentStatus.VERIFIED;
      await segment.save();

      expect(invalidateSpy).toHaveBeenCalledWith(MEDIA_INFO_CACHE);
      expect(mockSendDebounced).toHaveBeenCalledWith(
        'es-sync-update',
        { segmentId: segment.id, operation: 'UPDATE' },
        null,
        1,
        `${segment.id}`,
      );
    });

    it('does NOT invalidate cache when status is unchanged', async () => {
      const segment = await buildSegment().save();
      invalidateSpy.mockClear();
      mockSendDebounced.mockClear();

      segment.contentJa = '変更されたテキスト';
      await segment.save();

      expect(invalidateSpy).not.toHaveBeenCalled();
      expect(mockSendDebounced).toHaveBeenCalledWith(
        'es-sync-update',
        { segmentId: segment.id, operation: 'UPDATE' },
        null,
        1,
        `${segment.id}`,
      );
    });
  });

  describe('afterRemove', () => {
    it('invalidates cache and enqueues DELETE sync job', async () => {
      const segment = await buildSegment().save();
      const segmentId = segment.id;
      invalidateSpy.mockClear();
      mockSendDebounced.mockClear();

      await segment.remove();

      expect(invalidateSpy).toHaveBeenCalledWith(MEDIA_INFO_CACHE);
      expect(mockSendDebounced).toHaveBeenCalledWith(
        'es-sync-delete',
        { segmentId, operation: 'DELETE' },
        null,
        1,
        `${segmentId}`,
      );
    });
  });
});
