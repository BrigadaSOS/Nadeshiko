import { describe, test, expect, beforeEach, vi } from 'vitest';
import { ref } from 'vue';

/**
 * The player store's ACTIONS. `player.test.ts` beside this covers the pure
 * helpers it is built from; this drives the store itself.
 *
 * Three things here are stated in the source as deliberate and are each the kind
 * of bug that is invisible from the outside:
 *
 * - A REPEAT IS NOT A NEW PLAY. A looped clip billed a play every few seconds,
 *   which inflated the numerator of every per-play rate read off
 *   `segment_played`. It is still reported -- a re-listen is real engagement --
 *   just marked, so the two can be told apart.
 * - A STALE ELEMENT MUST NOT BE RESUMED. The reader expands a segment, presses
 *   play, and hears the sentence they already had, because the built element
 *   still points at the pre-expansion object.
 * - AN UNPLAYABLE CLIP IS NOT AN ENDED ONE. Routing it through `handleEnded`
 *   means that under repeat it fails, repeats and fails again as fast as the
 *   iframe can report it.
 */
const posthog = { capture: vi.fn() };

/** The YouTube iframe controller, which the store reaches for by name. */
const yt = {
  activeSegmentId: ref<string | null>(null),
  clipProgress: ref(0),
  hostId: ref('yt-host'),
  preload: vi.fn(),
  play: vi.fn(),
  resume: vi.fn(),
  pause: vi.fn(),
  restart: vi.fn(),
  retimeClip: vi.fn(),
  seekToClipFraction: vi.fn(),
  setVolume: vi.fn(),
  setPlaybackRate: vi.fn(),
  stop: vi.fn(),
};
vi.mock('~/composables/useYoutubeSegmentPlayer', () => ({ useYoutubeSegmentPlayer: () => yt }));

vi.stubGlobal('usePostHog', () => posthog);
vi.stubGlobal('useYoutubeSegmentPlayer', () => yt);
vi.stubGlobal('useSignupNudge', () => ({ recordPlay: vi.fn() }));
// A signed-out reader: `trackPlay` records activity only for a signed-in one,
// and that path has its own coverage in the auth store's tests.
vi.stubGlobal('userStore', () => ({ isLoggedIn: false }));
vi.stubGlobal('useNadeshikoSdk', () => ({ trackUserActivity: vi.fn().mockResolvedValue({}) }));

import { usePlayerStore } from './player';

/** A media-backed result: an ordinary audio clip. */
function audioResult(n: number, overrides: Record<string, unknown> = {}) {
  return {
    media: { publicId: `media-${n}`, nameRomaji: `Show ${n}`, category: 'ANIME' },
    segment: {
      publicId: `seg-${n}`,
      startTimeMs: n * 1000,
      endTimeMs: n * 1000 + 900,
      urls: { audioUrl: `https://cdn.test/seg-${n}.mp3` },
    },
    blobAudio: null as unknown,
    blobAudioUrl: null as string | null,
    expandedWindow: null as { startMs: number; endMs: number } | null,
    ...overrides,
  };
}

/** A YouTube result: played through the iframe, not through an element. */
function youtubeResult(n: number, overrides: Record<string, unknown> = {}) {
  return {
    media: { publicId: `media-${n}`, nameRomaji: `Channel ${n}`, category: 'YOUTUBE' },
    segment: {
      publicId: `seg-${n}`,
      externalVideoId: `vid-${n}`,
      startTimeMs: n * 1000,
      endTimeMs: n * 1000 + 900,
      urls: { audioUrl: `https://cdn.test/seg-${n}.mp3` },
    },
    blobAudio: null as unknown,
    blobAudioUrl: null as string | null,
    expandedWindow: null as { startMs: number; endMs: number } | null,
    ...overrides,
  };
}

/**
 * A media element double, standing in for the `Audio` the store builds.
 *
 * `readyState` is HAVE_ENOUGH_DATA so the store takes its ordinary path: an
 * unbuffered element sends it through a gesture-window play/pause dance for
 * iOS, which is a different behaviour and not the one these cases are about.
 */
function fakeAudio(src = 'https://cdn.test/seg-1.mp3') {
  return {
    src,
    volume: 1,
    playbackRate: 1,
    preservesPitch: false,
    currentTime: 0,
    paused: true,
    readyState: 4,
    onended: null as unknown,
    play: vi.fn().mockResolvedValue(undefined),
    pause: vi.fn(),
    load: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
}

/** The store's state is typed against the real `SearchResult`/`HTMLAudioElement`. */
const asResult = (r: unknown) => r as never;
const asAudio = (a: unknown) => a as never;

/**
 * `trackPlay` runs from the `play()` promise's `then`, so an assertion on the
 * event has to let the microtask queue drain first.
 */
async function settle() {
  await Promise.resolve();
  await Promise.resolve();
}

/** The properties of the last `segment_played` event. */
function lastPlayed() {
  return posthog.capture.mock.calls.filter(([name]) => name === 'segment_played').at(-1)?.[1];
}

beforeEach(() => {
  vi.clearAllMocks();
  yt.activeSegmentId.value = null;
});

describe('currentResult', () => {
  test('is null before anything is queued', () => {
    expect(usePlayerStore().currentResult).toBeNull();
  });

  test('is the result at the current index', () => {
    const store = usePlayerStore();
    store.playlist = [audioResult(1), audioResult(2)].map(asResult);
    store.currentIndex = 1;

    expect(store.currentResult?.segment.publicId).toBe('seg-2');
  });

  test('is null for an index the playlist does not reach', () => {
    // A playlist replaced by a shorter one while the player was open.
    const store = usePlayerStore();
    store.playlist = [audioResult(1)].map(asResult);
    store.currentIndex = 5;

    expect(store.currentResult).toBeNull();
  });
});

describe('isCurrentAudioStale', () => {
  test('is false when nothing is playing', () => {
    expect(usePlayerStore().isCurrentAudioStale).toBe(false);
  });

  test('is false when the element matches the result', () => {
    const store = usePlayerStore();
    store.playlist = [audioResult(1)].map(asResult);
    store.currentIndex = 0;
    store.currentAudio = asAudio(fakeAudio());
    store.currentSource = 'https://cdn.test/seg-1.mp3';

    expect(store.isCurrentAudioStale).toBe(false);
  });

  test('is TRUE once the result has been expanded underneath it', () => {
    // Resuming here replays the pre-expansion clip: the reader expands a
    // segment, presses play, and hears the sentence they already had.
    const store = usePlayerStore();
    const result = audioResult(1);
    store.playlist = [result].map(asResult);
    store.currentIndex = 0;
    store.currentAudio = asAudio(fakeAudio());
    store.currentSource = 'https://cdn.test/seg-1.mp3';

    result.blobAudioUrl = 'blob:expanded';

    expect(store.isCurrentAudioStale).toBe(true);
  });
});

describe('handleEnded', () => {
  test('replays the same clip under repeat', () => {
    const store = usePlayerStore();
    store.playlist = [audioResult(1), audioResult(2)].map(asResult);
    store.currentIndex = 0;
    store.repeat = true;

    store.handleEnded();

    expect(store.currentIndex).toBe(0);
  });

  test('marks a repeat as a repeat, so it is not counted as a sentence reached', async () => {
    // A looped clip billed a play every few seconds, inflating every per-play
    // rate read off this event.
    const store = usePlayerStore();
    store.playlist = [audioResult(1)].map(asResult);
    store.currentIndex = 0;
    store.repeat = true;

    store.handleEnded();
    await settle();

    expect(lastPlayed()).toMatchObject({ is_repeat: true });
  });

  test('moves on under autoplay', () => {
    const store = usePlayerStore();
    store.playlist = [audioResult(1), audioResult(2)].map(asResult);
    store.currentIndex = 0;
    store.autoplay = true;

    store.handleEnded();

    expect(store.currentIndex).toBe(1);
  });

  test('repeat wins over autoplay', () => {
    const store = usePlayerStore();
    store.playlist = [audioResult(1), audioResult(2)].map(asResult);
    store.currentIndex = 0;
    store.repeat = true;
    store.autoplay = true;

    store.handleEnded();

    expect(store.currentIndex).toBe(0);
  });

  test('just stops when neither is on', () => {
    const store = usePlayerStore();
    store.playlist = [audioResult(1), audioResult(2)].map(asResult);
    store.currentIndex = 0;
    store.isPlaying = true;

    store.handleEnded();

    expect(store.isPlaying).toBe(false);
    expect(store.currentIndex).toBe(0);
  });
});

describe('handleClipUnplayable', () => {
  test('does NOT replay under repeat, however the flag is set', () => {
    // Routed through `handleEnded` it would fail, repeat and fail again as fast
    // as the iframe could report it.
    const store = usePlayerStore();
    store.playlist = [youtubeResult(1)].map(asResult);
    store.currentIndex = 0;
    store.repeat = true;
    store.isPlaying = true;

    store.handleClipUnplayable();

    expect(store.isPlaying).toBe(false);
    expect(yt.play).not.toHaveBeenCalled();
  });

  test('still skips past it under autoplay, which is what a mining run wants', () => {
    const store = usePlayerStore();
    store.playlist = [youtubeResult(1), audioResult(2)].map(asResult);
    store.currentIndex = 0;
    store.autoplay = true;

    store.handleClipUnplayable();

    expect(store.currentIndex).toBe(1);
  });
});

describe('navigation', () => {
  function queued(count: number, at = 0) {
    const store = usePlayerStore();
    store.playlist = Array.from({ length: count }, (_, i) => asResult(audioResult(i + 1)));
    store.currentIndex = at;
    return store;
  }

  test('next advances', () => {
    const store = queued(3);

    store.next();

    expect(store.currentIndex).toBe(1);
  });

  test('next stops at the end rather than wrapping', () => {
    // Wrapping would make an autoplay run loop the page forever.
    const store = queued(2, 1);
    store.isPlaying = true;

    store.next();

    expect(store.currentIndex).toBe(1);
    expect(store.isPlaying).toBe(false);
  });

  test('prev goes back', () => {
    const store = queued(3, 2);

    store.prev();

    expect(store.currentIndex).toBe(1);
  });

  test('prev stops at the start', () => {
    const store = queued(3, 0);

    store.prev();

    expect(store.currentIndex).toBe(0);
  });

  test('records which way the reader moved, and where in the list', async () => {
    const store = queued(3);

    store.next();

    expect(posthog.capture).toHaveBeenCalledWith(
      'segment_navigated',
      expect.objectContaining({ direction: 'next', playlist_position: 1, playlist_size: 3 }),
    );
  });

  test('records nothing when there was nowhere to go', () => {
    const store = queued(1, 0);
    posthog.capture.mockClear();

    store.next();

    expect(posthog.capture.mock.calls.filter(([n]) => n === 'segment_navigated')).toHaveLength(0);
  });
});

describe('playback settings', () => {
  test('clamps a volume outside the range', () => {
    const store = usePlayerStore();

    store.setVolume(2);
    expect(store.volume).toBe(1);

    store.setVolume(-1);
    expect(store.volume).toBe(0);
  });

  test('snaps a playback rate to one the UI offers', () => {
    const store = usePlayerStore();

    store.setPlaybackRate(99);

    expect(store.playbackRate).toBeLessThanOrEqual(2);
  });

  test('pushes the settings onto whatever is playing', () => {
    // They live on the element, not on the source: a fresh `Audio` per clip
    // means an unstamped one silently reverts to 1x at full volume, which in a
    // mining run is every few seconds.
    const store = usePlayerStore();
    const audio = fakeAudio();
    store.currentAudio = asAudio(audio);

    store.setVolume(0.3);

    expect(audio.volume).toBe(0.3);
  });

  test('stamping keeps the pitch, so a slowed line is not transposed', () => {
    // 0.5x without this is an octave down, which is useless for hearing how a
    // word is actually pronounced.
    const store = usePlayerStore();
    const audio = fakeAudio();

    store.stampPlaybackSettings(asAudio(audio));

    expect(audio.preservesPitch).toBe(true);
  });

  test('pushes the settings to the iframe for a YouTube clip', () => {
    const store = usePlayerStore();
    store.playlist = [youtubeResult(1)].map(asResult);
    store.currentIndex = 0;

    store.setPlaybackRate(1.5);

    expect(yt.setPlaybackRate).toHaveBeenCalledWith(1.5);
    expect(yt.setVolume).toHaveBeenCalled();
  });

  test('reports where the slider was let go, not every step of the drag', () => {
    // `setVolume` fires on every step; this is bound to `change` instead, so
    // one adjustment is one event.
    const store = usePlayerStore();
    store.setVolume(0.42);
    posthog.capture.mockClear();

    store.trackVolumeChange();

    expect(posthog.capture).toHaveBeenCalledWith('player_volume_changed', { volume: 42 });
  });

  test('reports a rate change', () => {
    usePlayerStore().setPlaybackRate(1.5);

    expect(posthog.capture).toHaveBeenCalledWith('playback_rate_changed', { rate: 1.5 });
  });
});

describe('toggles', () => {
  test.each([
    ['autoplay', 'toggleAutoplay', 'autoplay_toggled'],
    ['isImmersive', 'toggleImmersive', 'immersive_mode_toggled'],
  ] as const)('%s flips and is reported', (flag, action, event) => {
    const store = usePlayerStore();

    (store[action] as () => void)();

    expect(store[flag]).toBe(true);
    expect(posthog.capture).toHaveBeenCalledWith(event, { enabled: true });
  });

  test('repeat flips without an event, because nothing reads one', () => {
    const store = usePlayerStore();
    posthog.capture.mockClear();

    store.toggleRepeat();

    expect(store.repeat).toBe(true);
    expect(posthog.capture).not.toHaveBeenCalled();
  });

  test('toggling twice returns to where it started', () => {
    const store = usePlayerStore();

    store.toggleAutoplay();
    store.toggleAutoplay();

    expect(store.autoplay).toBe(false);
  });
});

describe('releaseAudio', () => {
  test('stops the element and lets go of it', () => {
    const store = usePlayerStore();
    const audio = fakeAudio();
    store.currentAudio = asAudio(audio);
    store.currentSource = 'https://cdn.test/seg-1.mp3';

    store.releaseAudio();

    expect(audio.pause).toHaveBeenCalled();
    expect(audio.src).toBe('');
    expect(store.currentAudio).toBeNull();
    expect(store.currentSource).toBeNull();
  });

  test('detaches the ended handler, so a released element cannot advance the playlist', () => {
    const store = usePlayerStore();
    const audio = fakeAudio();
    audio.onended = () => {};
    store.currentAudio = asAudio(audio);

    store.releaseAudio();

    expect(audio.onended).toBeNull();
  });

  test('is safe when nothing is playing', () => {
    expect(() => usePlayerStore().releaseAudio()).not.toThrow();
  });
});

describe('releaseIfSource', () => {
  test('lets go when the element is playing that source', () => {
    // `useSegmentConcatenation` revokes an expansion's blob URL; one the player
    // still holds leaves the element pointed at an address that no longer
    // resolves, and the next seek fails with nothing the reader can act on.
    const store = usePlayerStore();
    store.currentAudio = asAudio(fakeAudio('blob:expanded'));
    store.currentSource = 'blob:expanded';
    store.isPlaying = true;

    store.releaseIfSource('blob:expanded');

    expect(store.currentAudio).toBeNull();
    expect(store.isPlaying).toBe(false);
  });

  test('keeps an element playing something else', () => {
    const store = usePlayerStore();
    const audio = fakeAudio();
    store.currentAudio = asAudio(audio);
    store.currentSource = 'https://cdn.test/seg-1.mp3';
    store.isPlaying = true;

    store.releaseIfSource('blob:someone-elses');

    // Compared by src rather than by reference: Pinia wraps state in a reactive
    // proxy, so what comes back out is never `===` what went in.
    expect((store.currentAudio as { src?: string } | null)?.src).toBe('https://cdn.test/seg-1.mp3');
    expect(store.isPlaying).toBe(true);
  });
});

describe('retimeCurrentClip', () => {
  test('moves the iframe onto the expanded window', () => {
    // A media element re-reads its source on the next play, but the iframe was
    // handed a start and an end when the clip loaded and holds them.
    const store = usePlayerStore();
    store.playlist = [youtubeResult(1, { expandedWindow: { startMs: 500, endMs: 5000 } })].map(asResult);
    store.currentIndex = 0;
    yt.activeSegmentId.value = 'seg-1';

    // Read back off the store: the action compares by reference against
    // `currentResult`, which is the reactive proxy rather than the raw object.
    store.retimeCurrentClip(store.currentResult!);

    expect(yt.retimeClip).toHaveBeenCalledWith(500, 5000);
  });

  test('does nothing for a clip that is not the one on the player', () => {
    // It finished, or another card took the iframe over. The next play reads
    // the window fresh, so there is nothing to move.
    const store = usePlayerStore();
    store.playlist = [youtubeResult(1)].map(asResult);
    store.currentIndex = 0;
    yt.activeSegmentId.value = 'seg-other';

    store.retimeCurrentClip(store.currentResult!);

    expect(yt.retimeClip).not.toHaveBeenCalled();
  });

  test('does nothing for a result that is not current', () => {
    const store = usePlayerStore();
    store.playlist = [youtubeResult(1)].map(asResult);
    store.currentIndex = 0;

    store.retimeCurrentClip(asResult(youtubeResult(2)));

    expect(yt.retimeClip).not.toHaveBeenCalled();
  });

  test('does nothing for an ordinary audio clip', () => {
    const store = usePlayerStore();
    store.playlist = [audioResult(1)].map(asResult);
    store.currentIndex = 0;

    store.retimeCurrentClip(store.currentResult!);

    expect(yt.retimeClip).not.toHaveBeenCalled();
  });
});

describe('play and pause', () => {
  test('resumes the iframe when it still holds this clip', () => {
    const store = usePlayerStore();
    store.playlist = [youtubeResult(1)].map(asResult);
    store.currentIndex = 0;
    yt.activeSegmentId.value = 'seg-1';

    store.play();

    expect(yt.resume).toHaveBeenCalled();
    expect(store.isPlaying).toBe(true);
  });

  test('reloads the clip when the iframe has moved on', () => {
    const store = usePlayerStore();
    store.playlist = [youtubeResult(1)].map(asResult);
    store.currentIndex = 0;
    yt.activeSegmentId.value = 'seg-other';

    store.play();

    expect(yt.resume).not.toHaveBeenCalled();
  });

  test('resumes a live element rather than rebuilding it', () => {
    const store = usePlayerStore();
    const audio = fakeAudio();
    store.playlist = [audioResult(1)].map(asResult);
    store.currentIndex = 0;
    store.currentAudio = asAudio(audio);
    store.currentSource = 'https://cdn.test/seg-1.mp3';

    store.play();

    expect(audio.play).toHaveBeenCalled();
  });

  test('does NOT resume a stale element -- it rebuilds', () => {
    // The whole point of `isCurrentAudioStale`.
    const store = usePlayerStore();
    const audio = fakeAudio();
    const result = audioResult(1);
    store.playlist = [result].map(asResult);
    store.currentIndex = 0;
    store.currentAudio = asAudio(audio);
    store.currentSource = 'https://cdn.test/seg-1.mp3';
    result.blobAudioUrl = 'blob:expanded';

    store.play();

    expect(audio.play).not.toHaveBeenCalled();
  });

  test('pause stops the element', () => {
    const store = usePlayerStore();
    const audio = fakeAudio();
    store.currentAudio = asAudio(audio);
    store.isPlaying = true;

    store.pause();

    expect(audio.pause).toHaveBeenCalled();
    expect(store.isPlaying).toBe(false);
  });

  test('pause stops the iframe for a YouTube clip', () => {
    const store = usePlayerStore();
    store.playlist = [youtubeResult(1)].map(asResult);
    store.currentIndex = 0;
    store.isPlaying = true;

    store.pause();

    expect(yt.pause).toHaveBeenCalled();
    expect(store.isPlaying).toBe(false);
  });

  test('togglePlay pauses what is playing and plays what is paused', () => {
    const store = usePlayerStore();
    const audio = fakeAudio();
    store.playlist = [audioResult(1)].map(asResult);
    store.currentIndex = 0;
    store.currentAudio = asAudio(audio);
    store.currentSource = 'https://cdn.test/seg-1.mp3';
    store.isPlaying = true;

    store.togglePlay();
    expect(store.isPlaying).toBe(false);

    store.togglePlay();
    expect(store.isPlaying).toBe(true);
  });
});

describe('restart', () => {
  test('rewinds a live element rather than rebuilding it', () => {
    const store = usePlayerStore();
    const audio = fakeAudio();
    audio.currentTime = 5;
    store.playlist = [audioResult(1)].map(asResult);
    store.currentIndex = 0;
    store.currentAudio = asAudio(audio);
    store.currentSource = 'https://cdn.test/seg-1.mp3';

    store.restart();

    expect(audio.currentTime).toBe(0);
    expect(audio.play).toHaveBeenCalled();
  });

  test('a rewound element is NOT counted as a play at all', () => {
    // It was never a play to take back out -- the element was already loaded.
    const store = usePlayerStore();
    const audio = fakeAudio();
    store.playlist = [audioResult(1)].map(asResult);
    store.currentIndex = 0;
    store.currentAudio = asAudio(audio);
    store.currentSource = 'https://cdn.test/seg-1.mp3';
    posthog.capture.mockClear();

    store.restart();

    expect(posthog.capture.mock.calls.filter(([n]) => n === 'segment_played')).toHaveLength(0);
  });

  test('a rebuilt element IS counted, and marked as a repeat', async () => {
    // The element is gone or stale, but it is still the reader asking for the
    // same sentence again.
    const store = usePlayerStore();
    store.playlist = [audioResult(1)].map(asResult);
    store.currentIndex = 0;

    store.restart();
    await settle();

    expect(lastPlayed()).toMatchObject({ is_repeat: true });
  });

  test('restarts the iframe for a YouTube clip', () => {
    const store = usePlayerStore();
    store.playlist = [youtubeResult(1)].map(asResult);
    store.currentIndex = 0;

    store.restart();

    expect(yt.restart).toHaveBeenCalled();
    expect(store.isPlaying).toBe(true);
  });

  test('reports the replay', () => {
    const store = usePlayerStore();
    store.playlist = [audioResult(1)].map(asResult);
    store.currentIndex = 0;

    store.restart();

    expect(posthog.capture).toHaveBeenCalledWith('segment_replayed', expect.objectContaining({ segment_id: 'seg-1' }));
  });

  test('does nothing with an empty playlist', () => {
    const store = usePlayerStore();
    posthog.capture.mockClear();

    store.restart();

    expect(posthog.capture).not.toHaveBeenCalled();
  });
});

describe('hidePlayer', () => {
  test('tears everything down', () => {
    const store = usePlayerStore();
    const audio = fakeAudio();
    store.playlist = [audioResult(1)].map(asResult);
    store.currentIndex = 0;
    store.currentAudio = asAudio(audio);
    store.showPlayer = true;
    store.isPlaying = true;
    store.isImmersive = true;

    store.hidePlayer();

    expect(store).toMatchObject({
      showPlayer: false,
      playlist: [],
      currentIndex: null,
      isPlaying: false,
      isImmersive: false,
      currentAudio: null,
    });
  });

  test('stops the iframe too, not only the element', () => {
    // Closing the player while a YouTube clip is up would otherwise leave it
    // playing audio with no visible transport to stop it.
    const store = usePlayerStore();
    store.playlist = [youtubeResult(1)].map(asResult);
    store.currentIndex = 0;

    store.hidePlayer();

    expect(yt.stop).toHaveBeenCalled();
  });

  test('keeps the remembered volume and speed, which are preferences', () => {
    // They persist across sessions; the playlist deliberately does not.
    const store = usePlayerStore();
    store.setVolume(0.25);
    store.setPlaybackRate(1.5);

    store.hidePlayer();

    expect(store.volume).toBe(0.25);
    expect(store.playbackRate).toBe(1.5);
  });
});

describe('setPlaylist', () => {
  test('opens the player on the chosen result', () => {
    const store = usePlayerStore();

    store.setPlaylist([audioResult(1), audioResult(2)].map(asResult), 1);

    expect(store.showPlayer).toBe(true);
    expect(store.currentIndex).toBe(1);
    expect(store.currentResult?.segment.publicId).toBe('seg-2');
  });

  test('leaves immersive mode, since a new selection is a new context', () => {
    const store = usePlayerStore();
    store.isImmersive = true;

    store.setPlaylist([asResult(audioResult(1))], 0);

    expect(store.isImmersive).toBe(false);
  });

  test('records which result in the list was opened', () => {
    const store = usePlayerStore();

    store.setPlaylist([audioResult(1), audioResult(2)].map(asResult), 1);

    expect(posthog.capture).toHaveBeenCalledWith(
      'search_result_clicked',
      expect.objectContaining({ media_id: 'media-2', result_position: 1 }),
    );
  });

  test('an out-of-range index opens the player without a result rather than throwing', () => {
    const store = usePlayerStore();

    store.setPlaylist([asResult(audioResult(1))], 5);

    expect(store.showPlayer).toBe(true);
    expect(store.currentResult).toBeNull();
  });
});
