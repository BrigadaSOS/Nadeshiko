import type { Ref } from 'vue';

import { reportError } from '~/utils/reportError';

/**
 * Inline YouTube playback for YOUTUBE segments via the IFrame Player API.
 *
 * iOS only plays media (with sound) from within a user-gesture, and the
 * `<video>` inside YouTube's cross-origin iframe is built asynchronously — so a
 * freshly-created player can never be started inside the tap. Instead we keep a
 * single *pre-warmed* player: its video element already exists and is unlocked
 * by the first tap, after which `loadVideoById` plays synchronously on every
 * later tap. One floating iframe is positioned over whichever segment is active,
 * so it still looks inline without re-parenting (which would reload the iframe).
 */

type PlayerState = {
  activeSegmentId: Ref<string | null>;
  clipProgress: Ref<number>;
};

/**
 * The reactive part of the player lives in `useState` so an SSR render can
 * never observe a value another request left behind. The cached handle is only
 * ever filled in on the client -- where there is a single app instance -- so the
 * DOM callbacks below (scroll/resize listeners, the progress interval) can reach
 * the state without a Nuxt context.
 */
let clientState: PlayerState | null = null;

function usePlayerState(): PlayerState {
  const state: PlayerState = {
    activeSegmentId: useState<string | null>('yt-segment-active-id', () => null),
    clipProgress: useState<number>('yt-segment-clip-progress', () => 0),
  };
  if (import.meta.client) clientState = state;
  return state;
}

type YtPlayer = {
  destroy?: () => void;
  pauseVideo?: () => void;
  playVideo?: () => void;
  seekTo?: (s: number, allowSeekAhead: boolean) => void;
  getCurrentTime?: () => number;
  loadVideoById?: (opts: { videoId: string; startSeconds?: number }) => void;
  setVolume?: (volume: number) => void;
  setPlaybackRate?: (rate: number) => void;
};

let player: YtPlayer | null = null;
let playerReady = false;
let container: HTMLElement | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let startSeconds = 0;
let endSeconds = 0;
/**
 * False from the moment a clip is loaded or seeked until the player is
 * reporting that clip's position rather than the one it was left on -- see
 * `isClipTimeSettled`.
 */
let clipArmed = false;
let armTicks = 0;
let endedCallback: (() => void) | null = null;
let failedCallback: (() => void) | null = null;
let apiReady: Promise<void> | null = null;
// Set when a tap happens before the warm player is ready; replayed on onReady.
let pendingVideoId: string | null = null;
let trackingBound = false;
// The player bar owns volume and speed for both playback paths. Held here
// rather than read back off the player because the store is the source of
// truth and this player may not exist yet when a value is set.
let desiredVolume = 1;
let desiredRate = 1;

const hostElId = (publicId: string) => `yt-host-${publicId}`;

function loadYouTubeApi(): Promise<void> {
  if (apiReady) return apiReady;
  apiReady = new Promise<void>((resolve) => {
    const w = window as unknown as { YT?: { Player: unknown }; onYouTubeIframeAPIReady?: () => void };
    if (w.YT?.Player) {
      resolve();
      return;
    }
    const prev = w.onYouTubeIframeAPIReady;
    w.onYouTubeIframeAPIReady = () => {
      prev?.();
      resolve();
    };
    if (!document.querySelector('script[src*="youtube.com/iframe_api"]')) {
      const s = document.createElement('script');
      s.src = 'https://www.youtube.com/iframe_api';
      document.head.appendChild(s);
    }
  });
  return apiReady;
}

/** Floating wrapper that holds the single warm iframe, positioned over a host. */
function ensureContainer() {
  if (container || !import.meta.client) return;
  container = document.createElement('div');
  container.dataset.testid = 'yt-floating-player';
  Object.assign(container.style, {
    position: 'fixed',
    top: '0px',
    left: '0px',
    width: '0px',
    height: '0px',
    zIndex: '5',
    overflow: 'hidden',
    display: 'none',
    // The app's player bar drives playback; let taps fall through to the card.
    pointerEvents: 'none',
  });
  document.body.appendChild(container);
}

/** Create the single warm player once (cued, paused) so it's ready to play. */
function ensureWarmPlayer(videoId: string) {
  if (!import.meta.client || player) return;
  ensureContainer();
  const w = window as unknown as {
    YT?: { Player: new (el: Element, opts: object) => YtPlayer };
  };
  if (!w.YT?.Player || !container) return;

  const mount = document.createElement('div');
  mount.style.width = '100%';
  mount.style.height = '100%';
  container.appendChild(mount);

  player = new w.YT.Player(mount, {
    // Privacy-enhanced mode also hides the Share / Watch Later buttons.
    host: 'https://www.youtube-nocookie.com',
    width: '100%',
    height: '100%',
    videoId,
    playerVars: {
      autoplay: 0,
      controls: 0,
      disablekb: 1,
      rel: 0,
      playsinline: 1,
      origin: window.location.origin,
    },
    events: {
      onReady: () => {
        playerReady = true;
        applyPlaybackSettings();
        // A tap happened before we were ready — start it now (cold-start only;
        // iOS may not autoplay this first one since it's outside the gesture).
        if (pendingVideoId && clientState?.activeSegmentId.value) {
          const id = pendingVideoId;
          pendingVideoId = null;
          startPlayback(id);
        }
      },
      onStateChange: (event: { data: number }) => handleStateChange(event.data),
      onError: (event: { data: number }) => handleError(event.data),
    },
  });
}

/** Align the floating iframe with the active segment's host element. */
function positionOverActive() {
  const activeId = clientState?.activeSegmentId.value;
  if (!container || !activeId) return;
  const anchor = document.getElementById(hostElId(activeId));
  if (!anchor) return;
  const r = anchor.getBoundingClientRect();
  container.style.top = `${r.top}px`;
  container.style.left = `${r.left}px`;
  container.style.width = `${r.width}px`;
  container.style.height = `${r.height}px`;
}

function bindTracking() {
  if (trackingBound || !import.meta.client) return;
  trackingBound = true;
  // capture:true so scrolls of any ancestor scroller reposition the player too.
  window.addEventListener('scroll', positionOverActive, { capture: true, passive: true });
  window.addEventListener('resize', positionOverActive, { passive: true });
}

function unbindTracking() {
  if (!trackingBound) return;
  trackingBound = false;
  window.removeEventListener('scroll', positionOverActive, { capture: true } as EventListenerOptions);
  window.removeEventListener('resize', positionOverActive);
}

/** How often the poll reads the playhead, in milliseconds. */
const POLL_INTERVAL_MS = 200;

/**
 * How many polls may pass before an unsettled clip is trusted anyway. Three
 * seconds is far longer than a load or a seek takes to move the playhead, and
 * short enough that the backstop below still stops the video near its clip.
 */
const ARM_GRACE_TICKS = 15;

/**
 * The `YT.PlayerState` values this player reacts to.
 */
const YT_STATE_ENDED = 0;
const YT_STATE_PLAYING = 1;

/**
 * What the `YT.PlayerError` codes mean, spelled out so the reports say why a
 * video would not play rather than leaving a bare number to be looked up.
 *
 * Written into the message rather than left as an attribute because the set is
 * closed and small: "removed or private" and "embedding turned off" are
 * different faults with different fixes, and one issue per video id -- which is
 * what interpolating the id would give -- is what makes such a report useless.
 */
const YT_ERROR_MESSAGES: Record<number, string> = {
  2: 'The player rejected the video id',
  5: 'The HTML5 player could not play the video',
  100: 'The video has been removed or made private',
  101: 'The video owner does not allow it to be embedded',
  150: 'The video owner does not allow it to be embedded',
};

/**
 * Whether the time the player reports can be read as the current clip's own.
 *
 * `loadVideoById` and `seekTo` do not move the playhead synchronously: for a
 * few hundred milliseconds after either, `getCurrentTime` still answers with
 * the position the player was left on. A reading at or past the new clip's end
 * can only be such a leftover -- the clip has not begun, so it cannot have
 * finished -- and taking one at face value ends the clip on the first poll
 * after it starts. That is what made playing an earlier segment right after a
 * later one of the same video skip straight past it to the next card.
 *
 * The tick count is the way out of the guard: a seek that lands past
 * `endSeconds` -- a clip shorter than the gap between keyframes -- would
 * otherwise never settle, and nothing would be left to stop the video.
 */
export function isClipTimeSettled(currentTime: number, endSeconds: number, ticksWaited: number): boolean {
  return currentTime < endSeconds || ticksWaited >= ARM_GRACE_TICKS;
}

/** Distrust the playhead until it reports the clip we just pointed it at. */
function disarmClip() {
  clipArmed = false;
  armTicks = 0;
}

/**
 * The clip's bounds, in seconds.
 *
 * Deliberately unrounded. `startTimeMs` is a millisecond cut and
 * `loadVideoById` takes a float, so the `Math.floor` this used to do bought
 * nothing and started every YouTube clip up to a second ahead of where the
 * same segment's mp3 starts.
 */
function setClipBounds(startMs: number, endMs: number) {
  startSeconds = Math.max(0, startMs / 1000);
  endSeconds = Math.max(startSeconds, endMs / 1000);
}

function stopPoll() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

function startPoll() {
  stopPoll();
  pollTimer = setInterval(() => {
    const t = player?.getCurrentTime?.() ?? 0;
    // Neither the progress bar nor the end of the clip may be read off a
    // playhead still sitting where the previous clip left it.
    if (!clipArmed) {
      const settled = isClipTimeSettled(t, endSeconds, armTicks);
      armTicks++;
      if (!settled) return;
      clipArmed = true;
    }
    const span = endSeconds - startSeconds;
    if (clientState) {
      clientState.clipProgress.value = span > 0 ? Math.min(1, Math.max(0, (t - startSeconds) / span)) : 0;
    }
    if (endSeconds > 0 && t >= endSeconds) finishClip();
  }, POLL_INTERVAL_MS);
}

function finishClip() {
  const cb = endedCallback;
  endedCallback = null;
  failedCallback = null;
  hide();
  cb?.();
}

/**
 * End a clip that never started, telling the caller it failed rather than that
 * it finished.
 *
 * The distinction matters upstream: "ended" means play it again when the reader
 * has repeat on, and a video that cannot load would fail, repeat, and fail
 * again as fast as the iframe could report it.
 */
function failClip() {
  const cb = failedCallback;
  endedCallback = null;
  failedCallback = null;
  hide();
  cb?.();
}

/**
 * Re-assert the wanted volume and speed on the player.
 *
 * Called on ready, on every load, and again once the loaded video reaches
 * PLAYING -- not once at setup: a player that has not finished loading drops
 * both, and while the IFrame API documents them as persisting across
 * `loadVideoById`, a clip that came back at the wrong speed is
 * indistinguishable to the reader from a broken control.
 */
function applyPlaybackSettings() {
  // The IFrame API takes volume as 0-100, unlike HTMLMediaElement's 0-1.
  player?.setVolume?.(Math.round(desiredVolume * 100));
  player?.setPlaybackRate?.(desiredRate);
}

/**
 * React to the player's own account of what it is doing.
 *
 * The only signal there is that a `loadVideoById` has finished: everything
 * before this point runs against a player that is still fetching, and the
 * IFrame API answers those calls from whatever it was playing before.
 */
function handleStateChange(state: number) {
  if (state === YT_STATE_PLAYING) {
    // Re-asserted here and not just at load time because a player mid-load
    // drops both -- see `applyPlaybackSettings`. This is the first moment the
    // new video is loaded enough to keep them.
    applyPlaybackSettings();
    return;
  }

  // The video ran out before the clip's end timestamp did. Without this a clip
  // whose end sits past the video's duration -- a re-upload trimmed since it
  // was indexed -- polls forever on a playhead that has stopped moving, and the
  // playlist never advances off it.
  if (state === YT_STATE_ENDED && clientState?.activeSegmentId.value) finishClip();
}

/**
 * Give up on a clip whose video will not play at all.
 *
 * Reached for a video that has been removed, made private, or had embedding
 * turned off since it was indexed. Giving the clip up is the point: nothing is
 * ever going to start, so the settle guard above would sit on a playhead that
 * never moves and the transport would show a clip running through silence with
 * no way to advance off it.
 */
function handleError(code: number) {
  // Nothing is playing: this is the pre-warmed player choking on the video it
  // was cued with, which nobody has asked to hear yet. The tap that does ask
  // for it will report the same failure with a segment attached.
  if (!clientState?.activeSegmentId.value) return;

  reportError('player:youtube-load-failed', new Error(YT_ERROR_MESSAGES[code] ?? 'The player failed to load a video'), {
    'youtube.error_code': String(code),
    'segment.publicId': clientState.activeSegmentId.value,
  });
  failClip();
}

/** Load + play the active segment's video on the warm player. */
function startPlayback(videoId: string) {
  if (!player?.loadVideoById) return;
  // The load below leaves the playhead on the previous clip until the new video
  // starts, so nothing may be read off it in the meantime.
  disarmClip();
  player.loadVideoById({ videoId, startSeconds });
  applyPlaybackSettings();
  player.playVideo?.();
  startPoll();
}

/** Pause and hide the floating player, keeping it warm/unlocked for reuse. */
function hide() {
  stopPoll();
  unbindTracking();
  pendingVideoId = null;
  player?.pauseVideo?.();
  if (container) container.style.display = 'none';
  if (clientState) {
    clientState.clipProgress.value = 0;
    clientState.activeSegmentId.value = null;
  }
}

export function useYoutubeSegmentPlayer() {
  const { activeSegmentId, clipProgress } = usePlayerState();

  // The card renders <div :id="hostId(publicId)"> used to anchor the player.
  const hostId = (publicId: string) => hostElId(publicId);

  /**
   * Warm up the API and pre-create the player so the first tap can play inside
   * the user-gesture window (required for iOS autoplay with sound).
   */
  function preload(videoId?: string) {
    if (!import.meta.client) return;
    ensureContainer();
    loadYouTubeApi().then(() => {
      if (videoId) ensureWarmPlayer(videoId);
    });
  }

  /** Stop and hide the inline player without notifying the store. */
  function stop() {
    endedCallback = null;
    failedCallback = null;
    hide();
  }

  /**
   * Show + play a segment's video inline, replacing any previously playing one.
   * `onEnded` fires once when the clip's end timestamp is reached, `onFailed`
   * once instead of it if the video turns out not to be playable at all.
   *
   * Runs synchronously so the play stays inside the tap gesture (iOS).
   */
  function play(
    publicId: string,
    videoId: string,
    startMs: number,
    endMs: number,
    callbacks?: { onEnded?: () => void; onFailed?: () => void },
  ) {
    endedCallback = callbacks?.onEnded ?? null;
    failedCallback = callbacks?.onFailed ?? null;
    setClipBounds(startMs, endMs);
    clipProgress.value = 0;
    activeSegmentId.value = publicId;

    ensureContainer();
    if (container) container.style.display = 'block';
    positionOverActive();
    bindTracking();

    if (playerReady) {
      // Fast path: warm player already running → play in-gesture (iOS).
      startPlayback(videoId);
    } else {
      // Player not warm yet: remember the request and warm it. The first play
      // after a cold start may not autoplay on iOS (outside the gesture).
      pendingVideoId = videoId;
      loadYouTubeApi().then(() => ensureWarmPlayer(videoId));
    }
  }

  function pause() {
    player?.pauseVideo?.();
    stopPoll();
  }

  function resume() {
    player?.playVideo?.();
    startPoll();
  }

  /** Seek back to the clip start (used by the player bar's restart). */
  function restart() {
    // Same leftover-playhead problem as a load: until the seek lands, the
    // player still reports the position the clip was restarted from, which is
    // at or past its end.
    disarmClip();
    clipProgress.value = 0;
    player?.seekTo?.(startSeconds, true);
    player?.playVideo?.();
    startPoll();
  }

  /**
   * Widen (or narrow) the playing clip and rewind to its new start.
   *
   * What an expansion needs: the video is already loaded, so there is nothing
   * to fetch -- only the window to move and the playhead to put back at the
   * start of the half that was just pulled in. A paused player stays paused,
   * since `seekTo` does not resume one, so this is safe to call whether or not
   * the reader is listening right now.
   */
  function retimeClip(startMs: number, endMs: number) {
    setClipBounds(startMs, endMs);
    clipProgress.value = 0;
    disarmClip();
    player?.seekTo?.(startSeconds, true);
  }

  /** Set volume as a 0..1 fraction, matching `HTMLMediaElement.volume`. */
  function setVolume(value: number) {
    desiredVolume = value;
    applyPlaybackSettings();
  }

  /** Set the playback rate. YouTube ignores rates outside the ones it offers. */
  function setPlaybackRate(rate: number) {
    desiredRate = rate;
    applyPlaybackSettings();
  }

  /** Seek to a fraction (0..1) of the clip window [start, end]. */
  function seekToClipFraction(fraction: number) {
    if (!player?.seekTo) return;
    const clamped = Math.min(Math.max(fraction, 0), 1);
    player.seekTo(startSeconds + clamped * (endSeconds - startSeconds), true);
  }

  return {
    activeSegmentId,
    clipProgress,
    hostId,
    preload,
    play,
    pause,
    resume,
    restart,
    retimeClip,
    seekToClipFraction,
    setVolume,
    setPlaybackRate,
    stop,
  };
}
