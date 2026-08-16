import { describe, it, expect } from 'vitest';

import type { SearchResult } from '~/types/search';
import { isUnactionablePlaybackError, resolveAudioSource } from './player';

const result = (blobAudioUrl: string | null): SearchResult =>
  ({
    media: { publicId: 'media-1', category: 'ANIME' },
    segment: { publicId: 'seg-1', urls: { audioUrl: 'https://cdn.test/seg-1.mp3' } },
    blobAudio: null,
    blobAudioUrl,
  }) as unknown as SearchResult;

describe('resolveAudioSource', () => {
  it('plays the original object when nothing has been expanded', () => {
    expect(resolveAudioSource(result(null))).toBe('https://cdn.test/seg-1.mp3');
  });

  it('prefers the expansion blob once one has been built', () => {
    expect(resolveAudioSource(result('blob:https://nadeshiko.co/abc'))).toBe('blob:https://nadeshiko.co/abc');
  });

  it('follows the result as it is expanded and reverted', () => {
    // The same object, read twice: this is what makes a built element go stale,
    // and reading it once per track is what let a resumed player keep replaying
    // the pre-expansion clip.
    const expanded = result(null);
    expect(resolveAudioSource(expanded)).toBe('https://cdn.test/seg-1.mp3');

    expanded.blobAudioUrl = 'blob:https://nadeshiko.co/abc';
    expect(resolveAudioSource(expanded)).toBe('blob:https://nadeshiko.co/abc');

    expanded.blobAudioUrl = null;
    expect(resolveAudioSource(expanded)).toBe('https://cdn.test/seg-1.mp3');
  });
});

describe('isUnactionablePlaybackError', () => {
  // The exact rejections production sees, verbatim, so a rename upstream shows
  // up here rather than as a fingerprint quietly filling back up.
  it('drops the aborts the reader causes', () => {
    expect(
      isUnactionablePlaybackError(
        new DOMException(
          'The play() request was interrupted because the media was removed from the document.',
          'AbortError',
        ),
      ),
    ).toBe(true);
    expect(isUnactionablePlaybackError(new DOMException('The operation was aborted.', 'AbortError'))).toBe(true);
  });

  it('drops the autoplay policy', () => {
    expect(
      isUnactionablePlaybackError(
        new DOMException('play() can only be initiated by a user gesture.', 'NotAllowedError'),
      ),
    ).toBe(true);
  });

  it('keeps a clip that will not decode', () => {
    // The one this fingerprint exists for: the source is there and the browser
    // refuses it. Filtering this would leave the issue reporting nothing.
    expect(
      isUnactionablePlaybackError(
        new DOMException('The media resource indicated by the src attribute was not suitable.', 'NotSupportedError'),
      ),
    ).toBe(false);
    expect(isUnactionablePlaybackError(new TypeError('Failed to fetch'))).toBe(false);
    expect(isUnactionablePlaybackError('AbortError')).toBe(false);
  });
});
