import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setupTestSuite } from '../helpers/setup';
import { loadFixtures, type LoadedFixtures } from '../fixtures/loader';
import { Segment, SegmentStatus } from '@app/models/Segment';
import { Cache } from '@lib/cache';
import { Media, MEDIA_INFO_CACHE } from '@app/models/Media';
import { setBossInstance } from '@app/workers/pgBossClient';

setupTestSuite();

let fixtures: LoadedFixtures;
let invalidateSpy: ReturnType<typeof vi.spyOn>;
let mockSendDebounced: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  fixtures = await loadFixtures(['mediaWithEpisode']);
  mockSendDebounced = vi.fn().mockResolvedValue('mock-job-id');
  setBossInstance({ sendDebounced: mockSendDebounced } as any);
  // Fixtures come back with fresh ids every test, so a map cached by an earlier one would
  // describe media that no longer exists and make "does this media look new?" answer yes.
  Cache.invalidate(MEDIA_INFO_CACHE);
  invalidateSpy = vi.spyOn(Cache, 'invalidate');
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

    // An ingest run inserts segments by the thousand for media the map already describes.
    // Dropping the namespace on each one kept the map permanently cold, so it never survived
    // long enough to be read twice and every concurrent search rebuilt it from scratch.
    it('leaves the cache alone for a media the cached map already knows', async () => {
      await Media.getMediaInfoMap();
      invalidateSpy.mockClear();

      await buildSegment().save();

      expect(invalidateSpy).not.toHaveBeenCalled();
    });

    it('still invalidates for a media the cached map has never seen', async () => {
      const cached = await Media.getMediaInfoMap();
      expect(cached.results.has(fixtures.media.testShow.id)).toBe(true);
      cached.results.delete(fixtures.media.testShow.id);
      invalidateSpy.mockClear();

      await buildSegment().save();

      expect(invalidateSpy).toHaveBeenCalledWith(MEDIA_INFO_CACHE);
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
