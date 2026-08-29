// @vitest-environment happy-dom
import { flushPromises } from '@vue/test-utils';
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * Inline YouTube playback for YOUTUBE segments.
 *
 * One PRE-WARMED player is kept and floated over whichever card is active,
 * because iOS only plays media with sound from inside a user gesture and a
 * freshly created player's `<video>` does not exist yet when the tap happens.
 * Nearly everything here follows from that: the player is a module singleton,
 * the state lives in `useState`, and a tap that arrives before the player is
 * warm has to be remembered and replayed.
 *
 * The behaviour most worth pinning is the SETTLE GUARD. `loadVideoById` and
 * `seekTo` do not move the playhead synchronously -- for a few hundred
 * milliseconds `getCurrentTime` still answers with the position the player was
 * left on. Believing it ends the clip on its first poll, which is what made
 * playing an earlier segment right after a later one of the same video skip
 * straight past it to the next card.
 *
 * The module holds mutable singletons, so every test re-imports it; otherwise
 * one test's warm player is the next test's.
 */
const reportError = vi.fn();
vi.mock('~/utils/reportError', () => ({ reportError: (...a: unknown[]) => reportError(...a) }));

/** Stands in for `YT.Player`, and lets a test drive the callbacks it registers. */
class FakePlayer {
  static instances: FakePlayer[] = [];
  opts: {
    videoId: string;
    host: string;
    playerVars: Record<string, unknown>;
    events: {
      onReady: () => void;
      onStateChange: (e: { data: number }) => void;
      onError: (e: { data: number }) => void;
    };
  };
  currentTime = 0;
  pauseVideo = vi.fn();
  playVideo = vi.fn();
  seekTo = vi.fn();
  loadVideoById = vi.fn();
  setVolume = vi.fn();
  setPlaybackRate = vi.fn();
  getCurrentTime = () => this.currentTime;

  constructor(_el: Element, opts: FakePlayer['opts']) {
    this.opts = opts;
    FakePlayer.instances.push(this);
  }

  ready() {
    this.opts.events.onReady();
  }
  fireState(state: number) {
    this.opts.events.onStateChange({ data: state });
  }
  fireError(code: number) {
    this.opts.events.onError({ data: code });
  }
}

const YT_ENDED = 0;
const YT_PLAYING = 1;
const POLL_MS = 200;
const ARM_GRACE_TICKS = 15;

/** A fresh copy of the module, with the singletons reset. */
async function load() {
  vi.resetModules();
  FakePlayer.instances = [];
  (window as unknown as { YT: unknown }).YT = { Player: FakePlayer };
  const mod = await import('./useYoutubeSegmentPlayer');
  const player = mod.useYoutubeSegmentPlayer();
  // `useState` outlives `resetModules`, so the previous test's active segment
  // would still be set and every "nothing is playing" branch would take the
  // other path.
  player.activeSegmentId.value = null;
  player.clipProgress.value = 0;
  return player;
}

/** The module with a warm, ready player -- the state after the first tap. */
async function loadWarm(videoId = 'vid-1') {
  const player = await load();
  player.preload(videoId);
  await flushPromises();
  FakePlayer.instances[0]!.ready();
  return { player, yt: FakePlayer.instances[0]! };
}

/** A card's anchor element, which the floating iframe is positioned over. */
function anchor(publicId: string, rect = { top: 100, left: 20, width: 320, height: 180 }) {
  const el = document.createElement('div');
  el.id = `yt-host-${publicId}`;
  el.getBoundingClientRect = () => rect as DOMRect;
  document.body.appendChild(el);
  return el;
}

const floatingPlayer = () => document.querySelector<HTMLElement>('[data-testid="yt-floating-player"]');

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  document.body.replaceChildren();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('the warm player', () => {
  test('is created once and left cued, not playing', async () => {
    const { yt } = await loadWarm();

    expect(FakePlayer.instances).toHaveLength(1);
    expect(yt.opts.playerVars.autoplay).toBe(0);
    expect(yt.playVideo).not.toHaveBeenCalled();
  });

  test('is not created a second time by a second preload', async () => {
    // One floating iframe is the whole design; a second would reload and lose
    // the gesture unlock the first one earned.
    const { player } = await loadWarm();

    player.preload('vid-2');
    await flushPromises();

    expect(FakePlayer.instances).toHaveLength(1);
  });

  test('runs on the no-cookie host, which also hides Share and Watch Later', async () => {
    const { yt } = await loadWarm();

    expect(yt.opts.host).toBe('https://www.youtube-nocookie.com');
  });

  test('shows no YouTube chrome, since the app’s own bar drives playback', async () => {
    const { yt } = await loadWarm();

    expect(yt.opts.playerVars.controls).toBe(0);
    expect(yt.opts.playerVars.disablekb).toBe(1);
  });

  test('plays inline rather than taking over the screen on a phone', async () => {
    const { yt } = await loadWarm();

    expect(yt.opts.playerVars.playsinline).toBe(1);
  });

  test('lets taps fall through to the card underneath it', async () => {
    // The floating iframe covers the card; without this the card's own
    // controls are unreachable.
    await loadWarm();

    expect(floatingPlayer()?.style.pointerEvents).toBe('none');
  });

  test('is hidden until something is played', async () => {
    await loadWarm();

    expect(floatingPlayer()?.style.display).toBe('none');
  });
});

describe('playing a clip', () => {
  test('loads and plays it on the warm player', async () => {
    const { player, yt } = await loadWarm();
    anchor('seg-1');

    player.play('seg-1', 'vid-1', 5000, 8000);

    expect(yt.loadVideoById).toHaveBeenCalledWith({ videoId: 'vid-1', startSeconds: 5 });
    expect(yt.playVideo).toHaveBeenCalled();
  });

  test('starts where the cut is, not on the second before it', async () => {
    // `startTimeMs` is a millisecond cut and `loadVideoById` takes a float, so
    // rounding down bought nothing and started every clip up to a second ahead
    // of where the same segment's mp3 starts.
    const { player, yt } = await loadWarm();
    anchor('seg-1');

    player.play('seg-1', 'vid-1', 5750, 8250);

    expect(yt.loadVideoById).toHaveBeenCalledWith({ videoId: 'vid-1', startSeconds: 5.75 });
  });

  test('never starts before the beginning of the video', async () => {
    const { player, yt } = await loadWarm();
    anchor('seg-1');

    player.play('seg-1', 'vid-1', -500, 8000);

    expect(yt.loadVideoById).toHaveBeenCalledWith({ videoId: 'vid-1', startSeconds: 0 });
  });

  test('marks the segment as the active one', async () => {
    const { player } = await loadWarm();
    anchor('seg-1');

    player.play('seg-1', 'vid-1', 0, 3000);

    expect(player.activeSegmentId.value).toBe('seg-1');
  });

  test('resets the progress bar, so it does not start where the last clip ended', async () => {
    const { player } = await loadWarm();
    anchor('seg-1');
    player.clipProgress.value = 0.9;

    player.play('seg-1', 'vid-1', 0, 3000);

    expect(player.clipProgress.value).toBe(0);
  });

  test('shows the floating player over the card that was tapped', async () => {
    const { player } = await loadWarm();
    anchor('seg-1', { top: 100, left: 20, width: 320, height: 180 });

    player.play('seg-1', 'vid-1', 0, 3000);

    const floating = floatingPlayer()!;
    expect(floating.style.display).toBe('block');
    expect(floating.style.top).toBe('100px');
    expect(floating.style.left).toBe('20px');
    expect(floating.style.width).toBe('320px');
    expect(floating.style.height).toBe('180px');
  });

  test('follows the card as the page scrolls', async () => {
    // The iframe is `position: fixed` and the card is not, so without this the
    // video stays put while the sentence it belongs to scrolls away.
    const { player } = await loadWarm();
    const host = anchor('seg-1', { top: 100, left: 20, width: 320, height: 180 });
    player.play('seg-1', 'vid-1', 0, 3000);

    host.getBoundingClientRect = () => ({ top: 40, left: 20, width: 320, height: 180 }) as DOMRect;
    window.dispatchEvent(new Event('scroll'));

    expect(floatingPlayer()?.style.top).toBe('40px');
  });

  test('and as the window is resized', async () => {
    const { player } = await loadWarm();
    const host = anchor('seg-1');
    player.play('seg-1', 'vid-1', 0, 3000);

    host.getBoundingClientRect = () => ({ top: 10, left: 5, width: 200, height: 120 }) as DOMRect;
    window.dispatchEvent(new Event('resize'));

    expect(floatingPlayer()?.style.width).toBe('200px');
  });
});

describe('a tap that arrives before the player is warm', () => {
  test('does not try to load before the player says it is ready', async () => {
    // Everything called on a player that has not fired `onReady` is answered
    // from whatever it was doing before, if at all.
    const player = await load();
    anchor('seg-1');

    player.play('seg-1', 'vid-1', 0, 3000);
    expect(FakePlayer.instances).toHaveLength(0);

    await flushPromises();
    expect(FakePlayer.instances[0]!.loadVideoById).not.toHaveBeenCalled();
  });

  test('is remembered and played as soon as the player is ready', async () => {
    // A cold start still has to end with the clip the reader asked for
    // playing, even though it misses the gesture window.
    const player = await load();
    anchor('seg-1');

    player.play('seg-1', 'vid-1', 2000, 5000);
    await flushPromises();
    FakePlayer.instances[0]!.ready();

    expect(FakePlayer.instances[0]!.loadVideoById).toHaveBeenCalledWith({ videoId: 'vid-1', startSeconds: 2 });
  });

  test('is dropped if the reader stopped before the player warmed up', async () => {
    // Otherwise a video starts playing over a page the reader has moved on
    // from, with nothing on screen to stop it.
    const player = await load();
    anchor('seg-1');

    player.play('seg-1', 'vid-1', 0, 3000);
    player.stop();
    await flushPromises();
    FakePlayer.instances[0]!.ready();

    expect(FakePlayer.instances[0]!.loadVideoById).not.toHaveBeenCalled();
  });
});

describe('the settle guard', () => {
  /** A warm player playing a clip, with the playhead under the test's control. */
  async function playing(startMs = 5000, endMs = 8000) {
    const { player, yt } = await loadWarm();
    anchor('seg-1');
    const onEnded = vi.fn();
    const onFailed = vi.fn();
    player.play('seg-1', 'vid-1', startMs, endMs, { onEnded, onFailed });
    return { player, yt, onEnded, onFailed };
  }

  test('does not end a clip on a playhead still sitting where the last one stopped', async () => {
    // Playing an earlier segment right after a later one of the same video:
    // `getCurrentTime` answers with the old position, which is past this
    // clip's end, and the clip is over before it began.
    const { yt, onEnded } = await playing(5000, 8000);

    yt.currentTime = 45; // Where the previous clip left off.
    vi.advanceTimersByTime(POLL_MS);

    expect(onEnded).not.toHaveBeenCalled();
  });

  test('does not move the progress bar off that leftover reading either', async () => {
    const { player, yt } = await playing(5000, 8000);

    yt.currentTime = 45;
    vi.advanceTimersByTime(POLL_MS);

    expect(player.clipProgress.value).toBe(0);
  });

  test('starts trusting the playhead once it reports this clip', async () => {
    const { player, yt } = await playing(5000, 8000);

    yt.currentTime = 6.5;
    vi.advanceTimersByTime(POLL_MS);

    expect(player.clipProgress.value).toBeCloseTo(0.5, 5);
  });

  test('gives up waiting after the grace period, so a short clip still stops', async () => {
    // A seek that lands past the end -- a clip shorter than the gap between
    // keyframes -- would otherwise never settle, and nothing would be left to
    // stop the video.
    const { yt, onEnded } = await playing(5000, 8000);

    yt.currentTime = 45;
    vi.advanceTimersByTime(POLL_MS * (ARM_GRACE_TICKS + 1));

    expect(onEnded).toHaveBeenCalled();
  });

  test('is re-armed for the NEXT clip of the same video', async () => {
    // The bug this whole guard exists for. Play a later segment, let the
    // playhead settle, then play an earlier one of the same video: the player
    // still reports the LATER position, which is past the new clip's end, and
    // a guard left armed from the first clip believes it. The second segment
    // was skipped straight past to the next card.
    const { player, yt } = await loadWarm();
    anchor('seg-1');
    anchor('seg-2');
    player.play('seg-1', 'vid-1', 40_000, 45_000);
    yt.currentTime = 41;
    vi.advanceTimersByTime(POLL_MS);

    const onEnded = vi.fn();
    player.play('seg-2', 'vid-1', 5000, 8000, { onEnded });
    yt.currentTime = 41; // The load has not moved the playhead yet.
    vi.advanceTimersByTime(POLL_MS);

    expect(onEnded).not.toHaveBeenCalled();
  });

  test('waits the whole grace period before doing so', async () => {
    const { yt, onEnded } = await playing(5000, 8000);

    yt.currentTime = 45;
    vi.advanceTimersByTime(POLL_MS * (ARM_GRACE_TICKS - 1));

    expect(onEnded).not.toHaveBeenCalled();
  });
});

describe('the progress bar', () => {
  async function playing(startMs: number, endMs: number) {
    const { player, yt } = await loadWarm();
    anchor('seg-1');
    player.play('seg-1', 'vid-1', startMs, endMs);
    return { player, yt };
  }

  test('reports how far through the CLIP the playhead is, not the video', async () => {
    const { player, yt } = await playing(10_000, 20_000);

    yt.currentTime = 15;
    vi.advanceTimersByTime(POLL_MS);

    expect(player.clipProgress.value).toBeCloseTo(0.5, 5);
  });

  test('never goes past the end of the bar', async () => {
    const { player, yt } = await playing(10_000, 20_000);

    yt.currentTime = 19.9;
    vi.advanceTimersByTime(POLL_MS);
    expect(player.clipProgress.value).toBeLessThanOrEqual(1);
  });

  test('never goes negative, which would render as a bar off its track', async () => {
    const { player, yt } = await playing(10_000, 20_000);

    yt.currentTime = 9;
    vi.advanceTimersByTime(POLL_MS);

    expect(player.clipProgress.value).toBe(0);
  });

  test('a zero-length clip reads as zero rather than as NaN', async () => {
    // `NaN%` on the bar's width is dropped by the browser, so the bar simply
    // stops rendering with no clue why.
    const { player, yt } = await playing(5000, 5000);

    yt.currentTime = 5;
    vi.advanceTimersByTime(POLL_MS);

    expect(player.clipProgress.value).toBe(0);
  });
});

describe('reaching the end of a clip', () => {
  async function playing() {
    const { player, yt } = await loadWarm();
    anchor('seg-1');
    const onEnded = vi.fn();
    const onFailed = vi.fn();
    player.play('seg-1', 'vid-1', 5000, 8000, { onEnded, onFailed });
    return { player, yt, onEnded, onFailed };
  }

  test('tells the caller once the end timestamp is reached', async () => {
    const { yt, onEnded } = await playing();

    yt.currentTime = 6;
    vi.advanceTimersByTime(POLL_MS);
    yt.currentTime = 8;
    vi.advanceTimersByTime(POLL_MS);

    expect(onEnded).toHaveBeenCalledTimes(1);
  });

  test('only once, however long the poll keeps running', async () => {
    // The caller's repeat handling would otherwise fire on every tick.
    const { yt, onEnded } = await playing();

    yt.currentTime = 6;
    vi.advanceTimersByTime(POLL_MS);
    yt.currentTime = 9;
    vi.advanceTimersByTime(POLL_MS * 5);

    expect(onEnded).toHaveBeenCalledTimes(1);
  });

  test('hides the floating player and lets go of the segment', async () => {
    const { player, yt } = await playing();

    yt.currentTime = 6;
    vi.advanceTimersByTime(POLL_MS);
    yt.currentTime = 8;
    vi.advanceTimersByTime(POLL_MS);

    expect(floatingPlayer()?.style.display).toBe('none');
    expect(player.activeSegmentId.value).toBeNull();
  });

  test('a video that runs OUT before the clip’s end does count as the end', async () => {
    // A re-upload trimmed since it was indexed. Without this the poll runs
    // forever on a playhead that has stopped, and the playlist never advances.
    const { yt, onEnded } = await playing();

    yt.fireState(YT_ENDED);

    expect(onEnded).toHaveBeenCalledTimes(1);
  });

  test('but the warm player running out with nothing active does not', async () => {
    const { player, yt } = await loadWarm();
    const onEnded = vi.fn();
    anchor('seg-1');
    player.play('seg-1', 'vid-1', 0, 3000, { onEnded });
    player.stop();

    yt.fireState(YT_ENDED);

    expect(onEnded).not.toHaveBeenCalled();
  });
});

describe('a video that will not play at all', () => {
  async function playing() {
    const { player, yt } = await loadWarm();
    anchor('seg-1');
    const onEnded = vi.fn();
    const onFailed = vi.fn();
    player.play('seg-1', 'vid-1', 0, 3000, { onEnded, onFailed });
    return { player, yt, onEnded, onFailed };
  }

  test('is reported as FAILED, not as ended', async () => {
    // "Ended" means play it again when the reader has repeat on, and a video
    // that cannot load would fail, repeat and fail again as fast as the iframe
    // could report it.
    const { yt, onEnded, onFailed } = await playing();

    yt.fireError(100);

    expect(onFailed).toHaveBeenCalledTimes(1);
    expect(onEnded).not.toHaveBeenCalled();
  });

  test('stops the clip rather than leaving it running through silence', async () => {
    const { player, yt } = await playing();

    yt.fireError(100);

    expect(player.activeSegmentId.value).toBeNull();
    expect(floatingPlayer()?.style.display).toBe('none');
  });

  test.each([
    [100, 'removed or made private'],
    [101, 'does not allow it to be embedded'],
    [150, 'does not allow it to be embedded'],
    [2, 'rejected the video id'],
    [5, 'could not play the video'],
  ])('says what code %i actually means', async (code, phrase) => {
    // "Removed or private" and "embedding turned off" are different faults
    // with different fixes; a bare number leaves them to be looked up.
    const { yt } = await playing();

    yt.fireError(code);

    expect(reportError).toHaveBeenCalledWith(
      'player:youtube-load-failed',
      expect.objectContaining({ message: expect.stringContaining(phrase) }),
      expect.anything(),
    );
  });

  test('records the code and the segment, not the video id', async () => {
    // One issue per video id is what makes such a report useless.
    const { yt } = await playing();

    yt.fireError(101);

    expect(reportError).toHaveBeenCalledWith(expect.anything(), expect.anything(), {
      'youtube.error_code': '101',
      'segment.publicId': 'seg-1',
    });
  });

  test('a code nobody has seen before still reports something', async () => {
    const { yt } = await playing();

    yt.fireError(999);

    expect(reportError).toHaveBeenCalled();
  });

  test('the warm player choking on its cued video is NOT reported', async () => {
    // Nobody has asked to hear it yet. The tap that does ask will report the
    // same failure with a segment attached.
    const { yt } = await loadWarm();

    yt.fireError(100);

    expect(reportError).not.toHaveBeenCalled();
  });
});

describe('volume and speed', () => {
  test('take a 0-1 volume and give the API the 0-100 it wants', async () => {
    // `HTMLMediaElement.volume` is 0-1 and the IFrame API is 0-100; the player
    // bar speaks the former for both playback paths.
    const { player, yt } = await loadWarm();

    player.setVolume(0.5);

    expect(yt.setVolume).toHaveBeenCalledWith(50);
  });

  test('round rather than hand the API a fraction', async () => {
    const { player, yt } = await loadWarm();

    player.setVolume(0.337);

    expect(yt.setVolume).toHaveBeenCalledWith(34);
  });

  test('mute is zero, not silence-by-rounding', async () => {
    const { player, yt } = await loadWarm();

    player.setVolume(0);

    expect(yt.setVolume).toHaveBeenCalledWith(0);
  });

  test('set the speed the bar asked for', async () => {
    const { player, yt } = await loadWarm();

    player.setPlaybackRate(1.5);

    expect(yt.setPlaybackRate).toHaveBeenCalledWith(1.5);
  });

  test('survive a load, which drops both on a player still fetching', async () => {
    const { player, yt } = await loadWarm();
    anchor('seg-1');
    player.setVolume(0.25);
    yt.setVolume.mockClear();

    player.play('seg-1', 'vid-1', 0, 3000);

    expect(yt.setVolume).toHaveBeenCalledWith(25);
  });

  test('and are re-asserted once the new video is actually playing', async () => {
    // The first moment the video is loaded enough to keep them. A clip that
    // came back at the wrong speed is indistinguishable from a broken control.
    const { player, yt } = await loadWarm();
    anchor('seg-1');
    player.setPlaybackRate(2);
    player.play('seg-1', 'vid-1', 0, 3000);
    yt.setPlaybackRate.mockClear();

    yt.fireState(YT_PLAYING);

    expect(yt.setPlaybackRate).toHaveBeenCalledWith(2);
  });

  test('a setting made before the player exists is applied when it appears', async () => {
    // The store is the source of truth and the reader may set volume on a page
    // with no YouTube segment in view.
    const player = await load();

    player.setVolume(0.4);
    player.preload('vid-1');
    await flushPromises();
    FakePlayer.instances[0]!.ready();

    expect(FakePlayer.instances[0]!.setVolume).toHaveBeenCalledWith(40);
  });
});

describe('the transport', () => {
  async function playing() {
    const { player, yt } = await loadWarm();
    anchor('seg-1');
    const onEnded = vi.fn();
    player.play('seg-1', 'vid-1', 5000, 8000, { onEnded });
    return { player, yt, onEnded };
  }

  test('pause stops the video and the progress polling with it', async () => {
    const { player, yt } = await playing();
    yt.currentTime = 6;
    vi.advanceTimersByTime(POLL_MS);
    const progressWhilePaused = player.clipProgress.value;

    player.pause();
    yt.currentTime = 7;
    vi.advanceTimersByTime(POLL_MS * 3);

    expect(yt.pauseVideo).toHaveBeenCalled();
    expect(player.clipProgress.value).toBe(progressWhilePaused);
  });

  test('resume starts both again', async () => {
    const { player, yt } = await playing();
    player.pause();

    player.resume();
    yt.currentTime = 6.5;
    vi.advanceTimersByTime(POLL_MS);

    expect(yt.playVideo).toHaveBeenCalled();
    expect(player.clipProgress.value).toBeCloseTo(0.5, 5);
  });

  test('restart goes back to the clip’s start, not the video’s', async () => {
    const { player, yt } = await playing();

    player.restart();

    expect(yt.seekTo).toHaveBeenCalledWith(5, true);
    expect(player.clipProgress.value).toBe(0);
  });

  test('restart distrusts the playhead until the seek lands', async () => {
    // Same leftover-playhead problem as a load: until it lands the player
    // still reports the position it was restarted FROM, which is at or past
    // the clip's end -- so the restart would end the clip immediately.
    const { player, yt, onEnded } = await playing();
    yt.currentTime = 7.9;
    vi.advanceTimersByTime(POLL_MS);

    player.restart();
    yt.currentTime = 8;
    vi.advanceTimersByTime(POLL_MS);

    expect(onEnded).not.toHaveBeenCalled();
  });

  test('seeking to a fraction lands inside the clip window', async () => {
    const { player, yt } = await playing();

    player.seekToClipFraction(0.5);

    expect(yt.seekTo).toHaveBeenCalledWith(6.5, true);
  });

  test.each([
    [-1, 5],
    [2, 8],
  ])('a fraction of %s is clamped into the window', async (fraction, expected) => {
    // A drag past either end of the bar would otherwise seek out of the clip
    // and into whatever the video has there.
    const { player, yt } = await playing();

    player.seekToClipFraction(fraction);

    expect(yt.seekTo).toHaveBeenCalledWith(expected, true);
  });

  test('stop hides the player without telling the caller the clip ended', async () => {
    // The reader stopped it; repeating it because it "ended" is the opposite
    // of what they asked for.
    const { player, onEnded } = await playing();

    player.stop();

    expect(onEnded).not.toHaveBeenCalled();
    expect(player.activeSegmentId.value).toBeNull();
    expect(floatingPlayer()?.style.display).toBe('none');
  });

  test('stop leaves the player warm for the next tap', async () => {
    // Destroying it would lose the gesture unlock and cost the next tap its
    // iOS autoplay.
    const { player, yt } = await playing();

    player.stop();

    expect(yt.pauseVideo).toHaveBeenCalled();
    expect(FakePlayer.instances).toHaveLength(1);
  });

  test('stop stops the polling too', async () => {
    const { player, yt } = await playing();

    player.stop();
    yt.currentTime = 7;
    vi.advanceTimersByTime(POLL_MS * 3);

    expect(player.clipProgress.value).toBe(0);
  });
});

describe('widening the clip while it plays', () => {
  async function playing() {
    const { player, yt } = await loadWarm();
    anchor('seg-1');
    player.play('seg-1', 'vid-1', 5000, 8000);
    return { player, yt };
  }

  test('rewinds to the start of the half just pulled in', async () => {
    // The video is already loaded, so there is nothing to fetch -- only the
    // window to move and the playhead to put back.
    const { player, yt } = await playing();

    player.retimeClip(2000, 8000);

    expect(yt.seekTo).toHaveBeenCalledWith(2, true);
  });

  test('does not reload the video', async () => {
    const { player, yt } = await playing();
    yt.loadVideoById.mockClear();

    player.retimeClip(2000, 8000);

    expect(yt.loadVideoById).not.toHaveBeenCalled();
  });

  test('does not start a paused player playing', async () => {
    // `seekTo` does not resume one, so this is safe whether or not the reader
    // is listening right now.
    const { player, yt } = await playing();
    player.pause();
    yt.playVideo.mockClear();

    player.retimeClip(2000, 8000);

    expect(yt.playVideo).not.toHaveBeenCalled();
  });

  test('measures progress against the NEW window', async () => {
    const { player, yt } = await playing();

    player.retimeClip(0, 10_000);
    yt.currentTime = 5;
    vi.advanceTimersByTime(POLL_MS);

    expect(player.clipProgress.value).toBeCloseTo(0.5, 5);
  });

  test('and ends at the new end', async () => {
    const { player, yt } = await loadWarm();
    anchor('seg-1');
    const onEnded = vi.fn();
    player.play('seg-1', 'vid-1', 5000, 8000, { onEnded });

    player.retimeClip(5000, 12_000);
    yt.currentTime = 9;
    vi.advanceTimersByTime(POLL_MS);
    expect(onEnded).not.toHaveBeenCalled();

    yt.currentTime = 12;
    vi.advanceTimersByTime(POLL_MS);
    expect(onEnded).toHaveBeenCalled();
  });
});

describe('the clip window', () => {
  test('never ends before it starts', async () => {
    // A segment whose timestamps arrived crossed. Left inverted, the end sits
    // BEFORE the playhead ever reaches the start, so the clip is declared over
    // while the video is still playing its way into it.
    const { player, yt } = await loadWarm();
    anchor('seg-1');
    const onEnded = vi.fn();

    player.play('seg-1', 'vid-1', 8000, 5000, { onEnded });
    yt.currentTime = 6; // Inside the inverted window, before the real start.
    vi.advanceTimersByTime(POLL_MS * (ARM_GRACE_TICKS + 1));

    expect(onEnded).not.toHaveBeenCalled();
  });

  test('a zero-length clip reports no progress rather than NaN', async () => {
    // Both timestamps at zero is what a bad ingest leaves behind. `0/0` is
    // NaN, and a bar whose width is `NaN%` is dropped by the browser: the bar
    // simply stops rendering, with nothing to say why.
    const { player, yt } = await loadWarm();
    anchor('seg-1');

    player.play('seg-1', 'vid-1', 0, 0);
    yt.currentTime = 0;
    vi.advanceTimersByTime(POLL_MS * (ARM_GRACE_TICKS + 1));

    expect(player.clipProgress.value).toBe(0);
  });
});
