/**
 * Inline YouTube playback for YOUTUBE segments via the IFrame Player API,
 * driven by the global player store so YouTube joins the playlist/autoplay.
 */
const activeSegmentId = ref<string | null>(null);
const clipProgress = ref(0);

type YtPlayer = {
  destroy?: () => void;
  pauseVideo?: () => void;
  playVideo?: () => void;
  seekTo?: (s: number, allowSeekAhead: boolean) => void;
  getCurrentTime?: () => number;
};

let player: YtPlayer | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let startSeconds = 0;
let endSeconds = 0;
let endedCallback: (() => void) | null = null;
let apiReady: Promise<void> | null = null;

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

function stopPoll() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

function teardown() {
  stopPoll();
  try {
    player?.destroy?.();
  } catch {
    // host may already be gone from the DOM; ignore.
  }
  player = null;
  clipProgress.value = 0;
  activeSegmentId.value = null;
}

export function useYoutubeSegmentPlayer() {
  // The card renders <div :id="hostId(publicId)"> which the API turns into the iframe.
  const hostId = (publicId: string) => `yt-host-${publicId}`;

  /** Stop and hide the inline player without notifying the store. */
  function stop() {
    endedCallback = null;
    teardown();
  }

  /**
   * Show + play a segment's video inline, replacing any previously playing one.
   * `onEnded` fires once when the clip's end timestamp is reached.
   */
  async function play(publicId: string, videoId: string, startMs: number, endMs: number, onEnded?: () => void) {
    teardown();
    endedCallback = onEnded ?? null;
    startSeconds = Math.max(0, Math.floor(startMs / 1000));
    endSeconds = Math.max(startSeconds, endMs / 1000);
    activeSegmentId.value = publicId;

    await nextTick();
    await loadYouTubeApi();
    if (activeSegmentId.value !== publicId) return; // superseded while loading

    const w = window as unknown as {
      YT?: { Player: new (el: Element, opts: object) => YtPlayer };
    };
    const host = document.getElementById(hostId(publicId));
    if (!w.YT?.Player || !host) return;

    const finish = () => {
      const cb = endedCallback;
      endedCallback = null;
      teardown();
      cb?.();
    };

    // Mount the player into a JS-created child so Vue (which owns the empty host
    // wrapper) never diffs/removes the API's iframe.
    host.replaceChildren();
    const mountPoint = document.createElement('div');
    mountPoint.className = 'w-full h-full';
    host.appendChild(mountPoint);

    player = new w.YT.Player(mountPoint, {
      width: '100%',
      height: '100%',
      videoId,
      playerVars: {
        start: startSeconds,
        autoplay: 1,
        rel: 0,
        playsinline: 1,
        origin: window.location.origin,
      },
      events: {
        onReady: () => {
          stopPoll();
          pollTimer = setInterval(() => {
            const t = player?.getCurrentTime?.() ?? 0;
            const span = endSeconds - startSeconds;
            clipProgress.value = span > 0 ? Math.min(1, Math.max(0, (t - startSeconds) / span)) : 0;
            if (endSeconds > 0 && t >= endSeconds) finish();
          }, 200);
        },
      },
    });
  }

  function pause() {
    player?.pauseVideo?.();
  }

  function resume() {
    player?.playVideo?.();
  }

  /** Seek back to the clip start (used by the player bar's restart). */
  function restart() {
    player?.seekTo?.(startSeconds, true);
    player?.playVideo?.();
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
    play,
    pause,
    resume,
    restart,
    seekToClipFraction,
    stop,
  };
}
