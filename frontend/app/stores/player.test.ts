import { describe, it, expect } from 'vitest';

import type { SearchResult } from '~/types/search';
import { resolveAudioSource } from './player';

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
