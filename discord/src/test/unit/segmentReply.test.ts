import { describe, test, expect, beforeEach } from 'vitest';
// Importing the mocks registers them; it has to come before the module under test.
import { resetApiMocks, mockDownloadFile } from '../mocks/api';

import { loadVideoFiles } from '../../segmentReply';
import { makeSegment } from '../mocks/fixtures';

/**
 * Discord blurs an attachment whose filename starts with `SPOILER_`, and that
 * prefix is the only thing standing between a QUESTIONABLE or EXPLICIT clip and
 * an unblurred autoplay in someone's server. It is invisible in review -- the
 * clip plays either way in local testing -- so it is asserted here.
 */
describe('loadVideoFiles', () => {
  beforeEach(() => {
    resetApiMocks();
    mockDownloadFile.mockResolvedValue(Buffer.from('video'));
  });

  test.each(['QUESTIONABLE', 'EXPLICIT'] as const)('marks a %s clip as a spoiler', async (contentRating) => {
    const [file] = await loadVideoFiles(makeSegment({ publicId: 'seg-1', contentRating }));

    expect(file?.name).toBe('SPOILER_seg-1.mp4');
  });

  test('leaves a SAFE clip unblurred', async () => {
    const [file] = await loadVideoFiles(makeSegment({ publicId: 'seg-1', contentRating: 'SAFE' }));

    expect(file?.name).toBe('seg-1.mp4');
  });

  test('returns no attachment when the download fails, rather than an empty file', async () => {
    // The reply still goes out with its text and buttons; only the clip is
    // missing. An empty attachment would look like a broken video instead.
    mockDownloadFile.mockResolvedValue(null);

    expect(await loadVideoFiles(makeSegment())).toEqual([]);
  });

  test('asks for the segment’s own video url', async () => {
    const segment = makeSegment();

    await loadVideoFiles(segment);

    expect(mockDownloadFile).toHaveBeenCalledWith(segment.urls.videoUrl);
  });
});
