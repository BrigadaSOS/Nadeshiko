import { describe, it, expect, vi } from 'vitest';

import type { SearchResult } from '~/types/search';
import {
  PLAYABLE_WAIT_MS,
  PLAYBACK_RATES,
  clampVolume,
  isUnactionablePlaybackError,
  normalizePlaybackRate,
  resolveAudioSource,
  whenPlayable,
} from './player';

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

describe('clampVolume', () => {
  it('keeps a fraction in range', () => {
    expect(clampVolume(0)).toBe(0);
    expect(clampVolume(0.42)).toBe(0.42);
    expect(clampVolume(1)).toBe(1);
  });

  it('pulls out-of-range values back to the ends', () => {
    // `HTMLMediaElement.volume` throws on anything outside 0..1, so a bad
    // persisted value would take playback down rather than just sound wrong.
    expect(clampVolume(-3)).toBe(0);
    expect(clampVolume(180)).toBe(1);
  });

  it('falls back to full volume for anything unreadable', () => {
    // What a hand-edited or older-shaped localStorage entry looks like coming
    // back. Silence would read as broken audio, so the fallback is loud.
    expect(clampVolume(undefined)).toBe(1);
    expect(clampVolume(null)).toBe(1);
    expect(clampVolume('loud')).toBe(1);
    expect(clampVolume(Number.NaN)).toBe(1);
  });
});

describe('PLAYBACK_RATES', () => {
  it('lists every rate once, in the order the menu shows them', () => {
    expect(new Set(PLAYBACK_RATES).size).toBe(PLAYBACK_RATES.length);
    expect([...PLAYBACK_RATES]).toEqual([0.5, 0.75, 1, 1.25, 1.5]);
  });

  it('includes normal speed, so the menu can get back to it', () => {
    expect(PLAYBACK_RATES).toContain(1);
  });
});

describe('normalizePlaybackRate', () => {
  it('passes the offered rates through untouched', () => {
    for (const rate of PLAYBACK_RATES) {
      expect(normalizePlaybackRate(rate)).toBe(rate);
    }
  });

  it('snaps an off-list rate to the nearest offered one', () => {
    // YouTube ignores a `setPlaybackRate` outside the rates it advertises, so
    // an off-list value would leave the two playback paths at different speeds.
    expect(normalizePlaybackRate(0.6)).toBe(0.5);
    expect(normalizePlaybackRate(0.9)).toBe(1);
    expect(normalizePlaybackRate(1.4)).toBe(1.5);
  });

  it('clamps past the ends of the list', () => {
    expect(normalizePlaybackRate(0.1)).toBe(0.5);
    expect(normalizePlaybackRate(4)).toBe(1.5);
  });

  it('falls back to normal speed for anything unreadable', () => {
    expect(normalizePlaybackRate(undefined)).toBe(1);
    expect(normalizePlaybackRate(null)).toBe(1);
    expect(normalizePlaybackRate('fast')).toBe(1);
    expect(normalizePlaybackRate(Number.NaN)).toBe(1);
  });
});

/** The slice of a media element `whenPlayable` touches, driveable by hand. */
class FakeAudio {
  readyState = 0;
  /** Set by the browser when the element has already failed; null until then. */
  error: unknown = null;
  private listeners: Record<string, Set<() => void>> = {};

  addEventListener(type: string, handler: () => void) {
    const handlers = this.listeners[type] ?? new Set();
    handlers.add(handler);
    this.listeners[type] = handlers;
  }

  removeEventListener(type: string, handler: () => void) {
    this.listeners[type]?.delete(handler);
  }

  emit(type: string) {
    for (const handler of [...(this.listeners[type] ?? [])]) handler();
  }

  listenerCount(type: string) {
    return this.listeners[type]?.size ?? 0;
  }
}

const playable = (audio: FakeAudio, timeoutMs = PLAYABLE_WAIT_MS) =>
  whenPlayable(audio as unknown as HTMLAudioElement, timeoutMs);

describe('whenPlayable', () => {
  it('does not wait for a clip that is already buffered', async () => {
    // The prefetched case, and the one that has to stay synchronous-ish: an
    // element ready to go must reach play() in the same tap that asked for it.
    const audio = new FakeAudio();
    audio.readyState = 4;

    await playable(audio);

    expect(audio.listenerCount('canplaythrough')).toBe(0);
  });

  it('holds a cold clip until it can play through', async () => {
    const audio = new FakeAudio();
    let resolved = false;
    const waiting = playable(audio).then(() => {
      resolved = true;
    });

    // `canplay` is the event that starts the clipped playback this exists to
    // prevent, so it is specifically not the one that releases the wait.
    audio.emit('canplay');
    await Promise.resolve();
    expect(resolved).toBe(false);

    audio.emit('canplaythrough');
    await waiting;
    expect(resolved).toBe(true);
  });

  it('gives up after the timeout rather than leaving a dead player', async () => {
    vi.useFakeTimers();
    try {
      const audio = new FakeAudio();
      let resolved = false;
      const waiting = playable(audio).then(() => {
        resolved = true;
      });

      vi.advanceTimersByTime(PLAYABLE_WAIT_MS - 1);
      await Promise.resolve();
      expect(resolved).toBe(false);

      vi.advanceTimersByTime(1);
      await waiting;
      expect(resolved).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('stops waiting on a clip the CDN has lost', async () => {
    // Resolving lets play() reject, which is the path that reports the failure.
    // Hanging here would report nothing and show a player stuck at zero.
    const audio = new FakeAudio();
    const waiting = playable(audio);

    audio.emit('error');

    await expect(waiting).resolves.toBeUndefined();
  });

  it('does not wait out the timeout for a clip that failed before anyone asked', async () => {
    // The prefetch case: the download ran ahead of the play, and took its
    // `error` while nobody was listening. An event that has already fired does
    // not fire again for a listener attached afterwards, so without the
    // `audio.error` check the only way out of here is the timeout -- two full
    // seconds of a dead player before play() rejects and reports it.
    vi.useFakeTimers();
    try {
      const audio = new FakeAudio();
      audio.error = { code: 4 };

      let resolved = false;
      const waiting = playable(audio).then(() => {
        resolved = true;
      });

      // No timer advanced, no event emitted: settling here is the whole point.
      await waiting;
      expect(resolved).toBe(true);
      expect(audio.listenerCount('error')).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('leaves nothing attached to the element once it settles', async () => {
    // Elements outlive one wait: a paused clip is resumed through the same path,
    // and handlers stacking up would fire several plays for one press.
    const audio = new FakeAudio();
    const waiting = playable(audio);

    audio.emit('canplaythrough');
    await waiting;

    expect(audio.listenerCount('canplaythrough')).toBe(0);
    expect(audio.listenerCount('error')).toBe(0);
  });
});
