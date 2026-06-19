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
  const id = activeSegmentId.value;
  if (import.meta.client && id) {
    document.getElementById(`yt-host-${id}`)?.replaceChildren();
  }
  clipProgress.value = 0;
  activeSegmentId.value = null;
}

export function useYoutubeSegmentPlayer() {
  // The card renders <div :id="hostId(publicId)"> which the API turns into the iframe.
  const hostId = (publicId: string) => `yt-host-${publicId}`;

  /**
   * Warm up the IFrame API ahead of the first tap. iOS only allows playback
   * (with sound) while the user-gesture activation is still alive, and that
   * activation is lost once play() has to fetch the API script over the
   * network. Loading it in advance keeps play()'s awaits to microtasks, which
   * preserve the activation so autoplay works on iOS.
   */
  function preload() {
    if (import.meta.client) loadYouTubeApi();
  }

  /** Stop and hide the inline player without notifying the store. */
  function stop() {
    endedCallback = null;
    teardown();
  }

  /**
   * Build the player into the segment's (already-rendered) host element.
   * Returns false when the API or host isn't ready yet. Stays synchronous so it
   * can run inside the tap handler: iOS only autoplays media when the iframe is
   * created within the user-gesture call stack.
   */
  function mountPlayer(publicId: string, videoId: string): boolean {
    const w = window as unknown as {
      YT?: { Player: new (el: Element, opts: object) => YtPlayer };
    };
    const host = document.getElementById(hostId(publicId));
    if (!w.YT?.Player || !host) return false;

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
      // Privacy-enhanced mode also hides the Share / Watch Later buttons.
      host: 'https://www.youtube-nocookie.com',
      width: '100%',
      height: '100%',
      videoId,
      playerVars: {
        start: startSeconds,
        autoplay: 1,
        controls: 0,
        disablekb: 1,
        rel: 0,
        playsinline: 1,
        origin: window.location.origin,
      },
      events: {
        onReady: () => {
          // Reinforce autoplay on iOS, where the autoplay playerVar alone is
          // sometimes ignored; this is still within the gesture activation.
          player?.playVideo?.();
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
    return true;
  }

  /**
   * Show + play a segment's video inline, replacing any previously playing one.
   * `onEnded` fires once when the clip's end timestamp is reached.
   *
   * Tries to mount synchronously (within the user gesture) so iOS autoplays;
   * only falls back to an async mount when the API/host aren't ready yet.
   */
  function play(publicId: string, videoId: string, startMs: number, endMs: number, onEnded?: () => void) {
    teardown();
    endedCallback = onEnded ?? null;
    startSeconds = Math.max(0, Math.floor(startMs / 1000));
    endSeconds = Math.max(startSeconds, endMs / 1000);
    activeSegmentId.value = publicId;

    // Fast path: API preloaded + host already in the DOM → mount in-gesture (iOS).
    if (mountPlayer(publicId, videoId)) return;

    // Fallback: wait for the API/host, then mount (may not autoplay on iOS).
    void (async () => {
      await loadYouTubeApi();
      await nextTick();
      if (activeSegmentId.value !== publicId) return; // superseded while loading
      mountPlayer(publicId, videoId);
    })();
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
    preload,
    play,
    pause,
    resume,
    restart,
    seekToClipFraction,
    stop,
  };
}
