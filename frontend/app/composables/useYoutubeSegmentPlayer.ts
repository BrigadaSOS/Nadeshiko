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
const activeSegmentId = ref<string | null>(null);
const clipProgress = ref(0);

type YtPlayer = {
  destroy?: () => void;
  pauseVideo?: () => void;
  playVideo?: () => void;
  seekTo?: (s: number, allowSeekAhead: boolean) => void;
  getCurrentTime?: () => number;
  loadVideoById?: (opts: { videoId: string; startSeconds?: number }) => void;
};

let player: YtPlayer | null = null;
let playerReady = false;
let container: HTMLElement | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let startSeconds = 0;
let endSeconds = 0;
let endedCallback: (() => void) | null = null;
let apiReady: Promise<void> | null = null;
// Set when a tap happens before the warm player is ready; replayed on onReady.
let pendingVideoId: string | null = null;
let trackingBound = false;

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
        // A tap happened before we were ready — start it now (cold-start only;
        // iOS may not autoplay this first one since it's outside the gesture).
        if (pendingVideoId && activeSegmentId.value) {
          const id = pendingVideoId;
          pendingVideoId = null;
          startPlayback(id);
        }
      },
    },
  });
}

/** Align the floating iframe with the active segment's host element. */
function positionOverActive() {
  if (!container || !activeSegmentId.value) return;
  const anchor = document.getElementById(hostElId(activeSegmentId.value));
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
    const span = endSeconds - startSeconds;
    clipProgress.value = span > 0 ? Math.min(1, Math.max(0, (t - startSeconds) / span)) : 0;
    if (endSeconds > 0 && t >= endSeconds) finishClip();
  }, 200);
}

function finishClip() {
  const cb = endedCallback;
  endedCallback = null;
  hide();
  cb?.();
}

/** Load + play the active segment's video on the warm player. */
function startPlayback(videoId: string) {
  if (!player?.loadVideoById) return;
  player.loadVideoById({ videoId, startSeconds });
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
  clipProgress.value = 0;
  activeSegmentId.value = null;
}

export function useYoutubeSegmentPlayer() {
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
    hide();
  }

  /**
   * Show + play a segment's video inline, replacing any previously playing one.
   * `onEnded` fires once when the clip's end timestamp is reached.
   *
   * Runs synchronously so the play stays inside the tap gesture (iOS).
   */
  function play(publicId: string, videoId: string, startMs: number, endMs: number, onEnded?: () => void) {
    endedCallback = onEnded ?? null;
    startSeconds = Math.max(0, Math.floor(startMs / 1000));
    endSeconds = Math.max(startSeconds, endMs / 1000);
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
    player?.seekTo?.(startSeconds, true);
    player?.playVideo?.();
    startPoll();
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
    seekToClipFraction,
    stop,
  };
}
