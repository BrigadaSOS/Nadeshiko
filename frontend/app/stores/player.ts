import { defineStore } from 'pinia';
import type { ClipWindow, SearchResult } from '~/types/search';
import { reportError } from '~/utils/reportError';
import { firstNonBlank } from '~/utils/strings';

function isYoutube(result: SearchResult | null): boolean {
  return !!result && result.media.category === 'YOUTUBE' && !!result.segment.externalVideoId;
}

/**
 * Resolve on every play: expansion or revert can change the audio source after the element was
 * built.
 */
export function resolveAudioSource(result: SearchResult): string {
  return result.blobAudioUrl ?? result.segment.urls.audioUrl;
}

/**
 * Resolve the clip window on every play. Expansions update expandedWindow, not the segment's
 * original timestamps.
 */
export function resolveClipWindow(result: SearchResult): ClipWindow {
  return result.expandedWindow ?? { startMs: result.segment.startTimeMs, endMs: result.segment.endTimeMs };
}

/**
 * Drop user-aborted loads and autoplay-policy refusals, but keep decode failures such as
 * NotSupportedError actionable.
 */
export function isUnactionablePlaybackError(error: unknown): boolean {
  // Match the standardized name, not Error or DOMException identity: playback rejection
  // prototypes vary across browsers.
  const name = (error as { name?: unknown } | null | undefined)?.name;
  return name === 'AbortError' || name === 'NotAllowedError';
}

/**
 * Every superseding playback intent takes a new token, so stale play() settlements cannot alter
 * state or analytics. Module scope is safe because audio exists only on the client.
 */
let playbackToken = 0;

/**
 * Client-only DOM handle kept outside store state. Retaining it keeps the prefetch alive;
 * source identifies stale downloads.
 */
let prefetched: { source: string; audio: HTMLAudioElement } | null = null;

/** `HTMLMediaElement.HAVE_ENOUGH_DATA` -- enough buffered to reach the end. */
const HAVE_ENOUGH_DATA = 4;

/** Bound the wait because canplaythrough may never fire on a stalled connection. */
export const PLAYABLE_WAIT_MS = 2000;

/**
 * Resolve once `audio` can play through without stalling, or once waiting for
 * that stops being worth it.
 *
 * Also resolves on `error`, rather than hanging: a clip the CDN has lost should
 * reach `play()` and reject there, which is the path that reports it.
 */
export function whenPlayable(audio: HTMLAudioElement, timeoutMs: number = PLAYABLE_WAIT_MS): Promise<void> {
  if (audio.readyState >= HAVE_ENOUGH_DATA) return Promise.resolve();

  // A prefetched element may already have emitted error; do not wait for an event that will not
  // fire again.
  if (audio.error) return Promise.resolve();

  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      audio.removeEventListener('canplaythrough', done);
      audio.removeEventListener('error', done);
      resolve();
    };
    const timer = setTimeout(done, timeoutMs);
    audio.addEventListener('canplaythrough', done);
    audio.addEventListener('error', done);
  });
}

/**
 * Set preload=auto before src so downloading starts immediately rather than stopping at
 * metadata.
 */
function buildAudio(source: string): HTMLAudioElement {
  const audio = new Audio();
  audio.preload = 'auto';
  audio.src = source;
  return audio;
}

/** Abandon the prefetched download, if there is one. */
function dropPrefetch() {
  if (!prefetched) return;
  prefetched.audio.src = '';
  prefetched.audio.load();
  prefetched = null;
}

/** The element already downloading `source`, or a fresh one. */
function takeAudio(source: string): HTMLAudioElement {
  if (prefetched?.source === source) {
    const { audio } = prefetched;
    prefetched = null;
    return audio;
  }
  return buildAudio(source);
}

export const PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5] as const;

const DEFAULT_PLAYBACK_RATE = 1;
const DEFAULT_VOLUME = 1;

/**
 * Volume as a 0..1 fraction, with anything unusable falling back to full.
 *
 * Non-numbers are rejected rather than coerced: `Number(null)` is 0, so a
 * missing or null-shaped persisted value would come back as silence -- which
 * reads as broken audio, not as a remembered preference.
 */
export function clampVolume(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_VOLUME;
  return Math.min(Math.max(value, 0), 1);
}

/**
 * The nearest offered rate to `value`.
 *
 * Snapped rather than clamped because both consumers are restricted to the
 * list: the button only ever cycles through it, and YouTube's IFrame API
 * ignores a `setPlaybackRate` outside `getAvailablePlaybackRates()`. Letting an
 * off-list number through would leave the two players at different speeds.
 */
export function normalizePlaybackRate(value: unknown): number {
  // Same reasoning as `clampVolume`: coercion would turn a null into 0, which
  // snaps to the slowest rate instead of falling back to normal speed.
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_PLAYBACK_RATE;
  return PLAYBACK_RATES.reduce((best, rate) => (Math.abs(rate - value) < Math.abs(best - value) ? rate : best));
}

/**
 * What a start of the audio element should be reported as.
 *
 * - `play`   -- a clip the reader reached: the thing every per-play rate counts.
 * - `repeat` -- the same clip again, from `repeat` mode or a manual restart.
 * - `none`   -- resuming a pause, which was never a new play to begin with.
 */
type TrackedPlay = 'play' | 'repeat' | 'none';

interface PlayerState {
  playlist: SearchResult[];
  currentIndex: number | null;
  isPlaying: boolean;
  showPlayer: boolean;
  currentAudio: HTMLAudioElement | null;
  /** The url `currentAudio` was built from, so a stale element can be spotted. */
  currentSource: string | null;
  autoplay: boolean;
  repeat: boolean;
  isImmersive: boolean;
  /** 0..1, mirrored onto `HTMLAudioElement.volume`. Remembered across sessions. */
  volume: number;
  /** One of `PLAYBACK_RATES`. Remembered across sessions. */
  playbackRate: number;
}

export const usePlayerStore = defineStore('player', {
  state: (): PlayerState => ({
    playlist: [],
    currentIndex: null,
    isPlaying: false,
    showPlayer: false,
    currentAudio: null,
    currentSource: null,
    autoplay: false,
    repeat: false,
    isImmersive: false,
    volume: DEFAULT_VOLUME,
    playbackRate: DEFAULT_PLAYBACK_RATE,
  }),

  // Persist only volume and speed, not a live playlist or element. Normalize again after
  // hydration to tolerate edited or older storage.
  persist: import.meta.client
    ? {
        key: 'player-prefs',
        storage: piniaPluginPersistedstate.localStorage(),
        pick: ['volume', 'playbackRate'],
        afterHydrate: (ctx) => {
          const store = ctx.store as unknown as PlayerState;
          store.volume = clampVolume(store.volume);
          store.playbackRate = normalizePlaybackRate(store.playbackRate);
        },
      }
    : false,

  getters: {
    currentResult(state): SearchResult | null {
      if (state.currentIndex !== null) {
        const result = state.playlist[state.currentIndex];
        if (result) {
          return result;
        }
      }
      return null;
    },

    /**
     * Whether the built element no longer matches what the current result should
     * play. Resuming it would replay the pre-expansion clip -- the reader expands
     * a segment, presses play, and hears the sentence they already had.
     */
    isCurrentAudioStale(): boolean {
      const result = this.currentResult;
      if (!result || !this.currentAudio) return false;
      return this.currentSource !== resolveAudioSource(result);
    },
  },

  actions: {
    setPlaylist(results: SearchResult[], startIndex: number) {
      this.playlist = results;
      this.currentIndex = startIndex;
      this.showPlayer = true;
      this.isImmersive = false;

      const result = results[startIndex];
      if (result && import.meta.client) {
        const posthog = usePostHog();
        posthog?.capture('search_result_clicked', {
          media_id: result.media.publicId,
          media_name: result.media.nameRomaji,
          result_position: startIndex,
        });
      }

      this.playCurrent();
    },

    handleEnded() {
      if (this.repeat) {
        this.playCurrent({ repeat: true });
      } else if (this.autoplay) {
        this.next();
      } else {
        this.isPlaying = false;
      }
    },

    /**
     * Do not treat an unplayable video as ended: repeat would retry forever. Autoplay may still
     * advance past it.
     */
    handleClipUnplayable() {
      if (this.autoplay) {
        this.next();
        return;
      }
      this.isPlaying = false;
    },

    /**
     * @param isRepeat Marks a loop or rebuilt restart as a re-listen, not a newly reached
     * sentence, while retaining engagement telemetry.
     */
    trackPlay(isRepeat = false) {
      const posthog = usePostHog();
      posthog?.capture('segment_played', {
        media_id: this.currentResult?.media.publicId,
        media_name: this.currentResult?.media.nameRomaji,
        segment_id: this.currentResult?.segment.publicId,
        playlist_position: this.currentIndex,
        is_autoplay: this.autoplay,
        is_repeat: isRepeat,
      });

      // Deliberate plays only, where deliberate means the reader chose this
      // clip: `this.autoplay` is the same flag the event above carries, so the
      // counter and the analytics agree on what a play is.
      //
      // `isRepeat` is deliberately NOT folded in here. A loop is not a sentence
      // reached for analytics, but it is still time spent on the site, which is
      // what the nudge counts -- so the two part company on purpose, and the
      // event carries both flags so either definition can be recovered.
      if (!this.autoplay) useSignupNudge().recordPlay();

      const user = userStore();
      if (user.isLoggedIn) {
        const sdk = useNadeshikoSdk();
        sdk
          .trackUserActivity({
            activityType: 'SEGMENT_PLAY',
            segmentPublicId: this.currentResult?.segment.publicId,
            mediaPublicId: this.currentResult?.media.publicId,
            // Not `media.nameRomaji` on its own: rows without a romaji title sent
            // `''`, which the API stored and later refused to serialize back.
            // Locale-independent order -- a store action has no `useI18n` context,
            // and this name is stored metadata rather than something rendered now.
            mediaName: firstNonBlank(
              this.currentResult?.media.nameRomaji,
              this.currentResult?.media.nameEn,
              this.currentResult?.media.nameJa,
            ),
            japaneseText: this.currentResult?.segment.textJa.content,
          })
          // Fire-and-forget telemetry: never let it interrupt or warn about audio
          // that is already playing.
          .catch((error: unknown) => reportError('player:track-play-activity-failed', error));
      }
    },

    /**
     * Start under a fresh token after buffering; discard superseded settlements. Track only the
     * successful start: new play, repeat, or unreported pause resume.
     */
    startAudio(audio: HTMLAudioElement, track: TrackedPlay) {
      const token = ++playbackToken;

      const started = () => {
        if (token !== playbackToken) return;
        this.isPlaying = true;
        if (track !== 'none') this.trackPlay(track === 'repeat');
      };

      const failed = (error: unknown) => {
        if (token !== playbackToken) return;
        this.isPlaying = false;

        // Note this is not the teardown case: `releaseIfSource`, `hidePlayer`
        // and every `playCurrent` branch bump `playbackToken` before releasing,
        // so a play() we cancelled ourselves is already discarded by the guard
        // above and never reaches here.
        if (isUnactionablePlaybackError(error)) return;

        // What survives is a clip that genuinely would not decode. The source
        // goes on the report because the segment id alone does not say which
        // url was tried: an expansion plays a blob built in the browser, and
        // it fails for reasons a CDN object never would.
        reportError('player:audio-play-failed', error, {
          'segment.publicId': this.currentResult?.segment.publicId ?? '',
          'audio.source': audio.src,
        });
      };

      // Buffered already -- which, with `prefetchNext` keeping a clip ahead, is
      // every play in a playlist but the first.
      if (audio.readyState >= HAVE_ENOUGH_DATA) {
        audio.play().then(started, failed);
        return;
      }

      // Prime play/pause synchronously inside the iOS gesture before awaiting buffering.
      // Pausing keeps it inaudible without muted playback reaching ended or gesture-less
      // unmuting stopping autoplay.
      const resumeAt = audio.currentTime;
      // Ignore the priming play's expected AbortError without changing isPlaying. The later,
      // token-guarded attempt reports the real outcome.
      audio.play().catch(() => {});
      audio.pause();

      whenPlayable(audio).then(() => {
        if (token !== playbackToken) return;
        // Back to where the priming left off: the element has not moved, but a
        // resume arrives here with the reader's position on it, and a clip
        // stopped halfway is rarely buffered to the end either.
        if (audio.currentTime !== resumeAt) audio.currentTime = resumeAt;
        audio.play().then(started, failed);
      });
    },

    /**
     * Detach the current media element: stop the download, drop the `onended`
     * closure holding this store, and let it be collected. Blob URLs are *not*
     * revoked here — they belong to `useSegmentConcatenation`, which still needs
     * them for the download/revert actions.
     */
    releaseAudio() {
      this.currentSource = null;
      const audio = this.currentAudio;
      if (!audio) return;
      audio.pause();
      audio.onended = null;
      audio.src = '';
      audio.load();
      this.currentAudio = null;
    },

    /**
     * Release the element if it is playing `source`, so the caller can revoke it.
     *
     * `useSegmentConcatenation` revokes an expansion's blob URL when the reader
     * reverts or expands again. Revoking one the player still holds leaves the
     * element pointed at an address that no longer resolves, which fails the next
     * seek or replay with no error the reader can act on.
     */
    releaseIfSource(source: string) {
      // Including the one being downloaded ahead: an element left pointed at a
      // revoked blob url fails on the play it was prefetched for.
      if (prefetched?.source === source) dropPrefetch();

      if (this.currentSource !== source) return;
      playbackToken++;
      this.releaseAudio();
      this.isPlaying = false;
    },

    /**
     * Move the player onto `result`'s clip window after an expansion changed it.
     *
     * Only the YouTube path needs telling. A media element re-reads its source
     * through `resolveAudioSource` on its next play, but the iframe was handed a
     * start and an end when the clip was loaded and holds them until something
     * says otherwise -- so an expansion made while the clip is up, or paused
     * part-way through, would keep playing the window it started with.
     */
    retimeCurrentClip(result: SearchResult) {
      if (this.currentResult !== result || !isYoutube(result)) return;
      const yt = useYoutubeSegmentPlayer();
      // Not the clip on the player: it finished, or another card took it over.
      // The next play reads the window fresh, so there is nothing to move.
      if (yt.activeSegmentId.value !== result.segment.publicId) return;

      const clip = resolveClipWindow(result);
      yt.retimeClip(clip.startMs, clip.endMs);
    },

    /**
     * @param repeat Whether this is the same clip starting over rather than a
     *               new one being reached. Threaded in by the callers that know
     *               -- `handleEnded` under `repeat` mode, and the `restart` path
     *               that has to rebuild a stale element -- because by the time
     *               `trackPlay` runs there is nothing left to tell them apart:
     *               a loop rebuilds the element exactly as a fresh play does.
     */
    playCurrent({ repeat = false }: { repeat?: boolean } = {}) {
      this.releaseAudio();

      const result = this.currentResult;
      if (!result) {
        playbackToken++;
        // Nothing to play, so nothing is playing. Without this the flag keeps
        // whatever the previous clip left on it and the transport sits showing
        // a pause button over silence -- `releaseAudio` above has already
        // detached the element, so there is not even anything to press it on.
        // Reachable through an out-of-range `startIndex` into `setPlaylist`.
        this.isPlaying = false;
        return;
      }

      const yt = useYoutubeSegmentPlayer();

      if (isYoutube(result)) {
        playbackToken++;
        const seg = result.segment;
        const clip = resolveClipWindow(result);
        yt.play(seg.publicId, seg.externalVideoId ?? '', clip.startMs, clip.endMs, {
          onEnded: () => this.handleEnded(),
          onFailed: () => this.handleClipUnplayable(),
        });
        yt.setVolume(this.volume);
        yt.setPlaybackRate(this.playbackRate);
        this.isPlaying = true;
        this.trackPlay(repeat);
        this.prefetchNext();
        return;
      }

      yt.stop();
      const audioUrl = resolveAudioSource(result);
      // markRaw: the media element is a DOM handle, not state to make reactive or
      // serialize into the SSR payload.
      const audio = markRaw(takeAudio(audioUrl));
      this.currentAudio = audio;
      this.stampPlaybackSettings(audio);
      // Remembered so a later play can tell this element apart from what the
      // result should be playing by then -- see `isCurrentAudioStale`.
      this.currentSource = audioUrl;
      // Leave crossOrigin unset so ordinary playback does not depend on permissive CDN CORS.
      // Expansion's extra fetch keeps any CORS failure confined to expansion.

      this.startAudio(audio, repeat ? 'repeat' : 'play');

      audio.onended = () => this.handleEnded();

      this.prefetchNext();
    },

    /**
     * Prefetch only the next clip to hide buffering without wasting bandwidth on skipped
     * tracks. YouTube streams through its own player.
     */
    prefetchNext() {
      if (!import.meta.client) return;

      const next = this.currentIndex === null ? null : this.playlist[this.currentIndex + 1];
      if (!next || isYoutube(next)) {
        dropPrefetch();
        return;
      }

      // Read through `resolveAudioSource` like every other play: a segment the
      // reader expanded before reaching it must not be prefetched as its
      // pre-expansion clip -- `takeAudio` would then miss and the download would
      // have been for nothing.
      const source = resolveAudioSource(next);

      // Do not prefetch local expansion blobs: it saves no request and holds another decoded
      // copy. Drop any stale plain-clip prefetch.
      if (source.startsWith('blob:')) {
        dropPrefetch();
        return;
      }

      if (prefetched?.source === source) return;

      dropPrefetch();
      prefetched = { source, audio: buildAudio(source) };
    },

    play() {
      if (isYoutube(this.currentResult)) {
        const yt = useYoutubeSegmentPlayer();
        if (yt.activeSegmentId.value === this.currentResult?.segment.publicId) {
          playbackToken++;
          yt.resume();
        } else {
          this.playCurrent();
        }
        this.isPlaying = true;
      } else if (this.currentAudio && !this.isCurrentAudioStale) {
        this.startAudio(this.currentAudio, 'none');
        this.isPlaying = true;
      } else {
        this.playCurrent();
      }
    },

    pause() {
      if (isYoutube(this.currentResult)) {
        playbackToken++;
        useYoutubeSegmentPlayer().pause();
        this.isPlaying = false;
      } else if (this.currentAudio) {
        playbackToken++;
        this.currentAudio.pause();
        this.isPlaying = false;
      }
    },

    togglePlay() {
      if (this.isPlaying) {
        this.pause();
      } else {
        this.play();
      }
    },

    /**
     * Copy the remembered volume and speed onto a media element.
     *
     * Needed on every element rather than once, because both live on the
     * element and not on the source: `playCurrent` builds a fresh `Audio` per
     * clip, so an unstamped one silently reverts to 1x at full volume. In a
     * mining run that is every few seconds.
     */
    stampPlaybackSettings(audio: HTMLAudioElement) {
      audio.volume = this.volume;
      audio.playbackRate = this.playbackRate;
      // Slowing a line must not transpose it -- 0.5x without this is an octave
      // down, which is useless for hearing how a word is actually pronounced.
      // True by default everywhere current, set anyway so the intent is on the
      // record rather than inherited.
      audio.preservesPitch = true;
    },

    /** Push the current volume and speed onto whatever is playing right now. */
    applyPlaybackSettings() {
      if (this.currentAudio) this.stampPlaybackSettings(this.currentAudio);
      if (isYoutube(this.currentResult)) {
        const yt = useYoutubeSegmentPlayer();
        yt.setVolume(this.volume);
        yt.setPlaybackRate(this.playbackRate);
      }
    },

    setVolume(value: number) {
      this.volume = clampVolume(value);
      this.applyPlaybackSettings();
    },

    /**
     * Capture the slider's change event, not each input step, so one adjustment produces one
     * event.
     */
    trackVolumeChange() {
      const posthog = usePostHog();
      posthog?.capture('player_volume_changed', { volume: Math.round(this.volume * 100) });
    },

    setPlaybackRate(value: number) {
      this.playbackRate = normalizePlaybackRate(value);
      this.applyPlaybackSettings();
      const posthog = usePostHog();
      posthog?.capture('playback_rate_changed', { rate: this.playbackRate });
    },

    toggleAutoplay() {
      this.autoplay = !this.autoplay;
      const posthog = usePostHog();
      posthog?.capture('autoplay_toggled', { enabled: this.autoplay });
    },

    toggleRepeat() {
      this.repeat = !this.repeat;
    },

    toggleImmersive() {
      this.isImmersive = !this.isImmersive;
      const posthog = usePostHog();
      posthog?.capture('immersive_mode_toggled', { enabled: this.isImmersive });
    },

    next() {
      if (this.currentIndex !== null && this.currentIndex < this.playlist.length - 1) {
        this.currentIndex++;
        this.playCurrent();
        const posthog = usePostHog();
        posthog?.capture('segment_navigated', {
          direction: 'next',
          playlist_position: this.currentIndex,
          playlist_size: this.playlist.length,
        });
      } else {
        this.isPlaying = false;
      }
    },

    prev() {
      if (this.currentIndex !== null && this.currentIndex > 0) {
        this.currentIndex--;
        this.playCurrent();
        const posthog = usePostHog();
        posthog?.capture('segment_navigated', {
          direction: 'prev',
          playlist_position: this.currentIndex,
          playlist_size: this.playlist.length,
        });
      }
    },

    restart() {
      if (isYoutube(this.currentResult)) {
        playbackToken++;
        useYoutubeSegmentPlayer().restart();
        this.isPlaying = true;
      } else if (this.currentAudio && !this.isCurrentAudioStale) {
        this.currentAudio.currentTime = 0;
        this.startAudio(this.currentAudio, 'none');
        this.isPlaying = true;
      } else if (this.currentResult) {
        // Rebuilt rather than rewound, because the element is gone or stale --
        // but it is still the reader asking for the same sentence again, so it
        // reports as a repeat. Marked here and not in the branch above because
        // that one never reaches `trackPlay` at all: rewinding a live element
        // was never a play to take back out.
        this.playCurrent({ repeat: true });
      } else {
        return;
      }
      const posthog = usePostHog();
      posthog?.capture('segment_replayed', {
        media_id: this.currentResult?.media.publicId,
        segment_id: this.currentResult?.segment.publicId,
      });
    },

    hidePlayer() {
      playbackToken++;
      this.releaseAudio();
      dropPrefetch();
      useYoutubeSegmentPlayer().stop();
      this.showPlayer = false;
      this.playlist = [];
      this.currentIndex = null;
      this.isPlaying = false;
      this.isImmersive = false;
    },
  },
});
