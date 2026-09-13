import { afterEach, describe, expect, test, vi } from 'vitest';
import { loadPitchContour } from './pitchContourAudio';

vi.mock('~/utils/media', () => ({
  fetchAudioSegment: vi.fn(async () => ({ response: new Response(new ArrayBuffer(0)) })),
}));

describe('loadPitchContour', () => {
  afterEach(() => vi.unstubAllGlobals());
  test('fails clearly when audio analysis is unavailable', async () => {
    vi.stubGlobal('window', {});
    await expect(loadPitchContour('https://cdn.test/clip.mp3')).rejects.toThrow(
      'This browser does not support audio analysis',
    );
  });
});
