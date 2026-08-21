import { defineStore } from 'pinia';
import type { SearchResult } from '~/types/search';
import { reportError } from '~/utils/reportError';
import { firstNonBlank } from '~/utils/strings';

function isYoutube(result: SearchResult | null): boolean {
  return !!result && result.media.category === 'YOUTUBE' && !!result.segment.externalVideoId;
}

/**
 * The audio a result should play right now: its expansion blob when one has been
 * built, the original object otherwise.
 *
 * Read on every play rather than once per track. Expanding a segment swaps the
 * blob in (and reverting swaps it back out) long after the element was built, and
 * a paused player resuming its old element is how "the audio doesn't get replaced"
 * survived even when the expansion itself had worked.
 */
export function resolveAudioSource(result: SearchResult): string {
  return result.blobAudioUrl ?? result.segment.urls.audioUrl;
}

/**
 * Rejections of `HTMLAudioElement.play()` that describe the reader rather than a
 * fault, and so are dropped instead of reported.
 *
 * - `AbortError`: the user agent abandoned the load "at the user's request" --
 *   navigating away, closing the tab, stopping playback mid-load.
 * - `NotAllowedError`: the autoplay policy. This play() was not close enough to
 *   a gesture for the reader's settings; they press play again and it works.
 *
 * Filtered here rather than tolerated in PostHog, because an issue nobody acts
 * on is worse than no issue: its status and last-seen stop describing anything,
 * and the `NotSupportedError` cases underneath -- a clip that genuinely will not
 * decode, which IS worth knowing about -- get read as more of the same. Between
 * them these two were 234 of the 255 reports on this fingerprint over a week,
 * out of 9 sessions; the 21 that matter came from 14. The same confusion
 * `$exception_fingerprint` was added to `reportError` to end.
 */
export function isUnactionablePlaybackError(error: unknown): boolean {
  // Matched on `name` against any Error rather than on `instanceof DOMException`:
  // the name is the part the spec pins down, and narrowing to the class buys
  // nothing here -- nothing else rejects a play() with either of these names.
  return error instanceof Error && (error.name === 'AbortError' || error.name === 'NotAllowedError');
}

/**
 * Identifies the most recent playback intent. `HTMLAudioElement.play()` settles
 * asynchronously, so a promise from a track the user already skipped past would
 * otherwise flip `isPlaying` and fire analytics for whatever is playing *now* —
 * and its expected AbortError would report as a failure. Every action that
 * supersedes playback (new track, pause, hide) takes a fresh token; stale
 * settlements compare unequal and do nothing.
 *
 * Module scope is safe: audio only ever exists on the client.
 */
let playbackToken = 0;

/**
 * A clip downloaded ahead of the play it is for, and the source it was built
 * from so a stale one can be spotted.
 *
 * Module scope for the same reason as `playbackToken`, and deliberately not part
 * of the store's state: a media element is a DOM handle, and the only reason to
 * hold a reference at all is so the browser does not abandon the download when
 * the element becomes unreachable.
 */
let prefetched: { source: string; audio: HTMLAudioElement } | null = null;

/** `HTMLMediaElement.HAVE_ENOUGH_DATA` -- enough buffered to reach the end. */
const HAVE_ENOUGH_DATA = 4;

/**
 * How long a clip is given to buffer before it is played anyway.
 *
 * There has to be a ceiling: `canplaythrough` is an estimate the browser is
 * free never to make on a connection that keeps stalling, and a player that
 * shows nothing happening is worse than one whose first word is rough. Two
 * seconds is far longer than a ~17KB clip needs on anything that works, so in
 * practice this only ever fires when the alternative was silence.
 */
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

  // Already failed, before anyone got here. A prefetched element can have taken
  // its `error` on the download that ran ahead of the play, and an event that
  // has fired does not fire again for a listener attached afterwards -- so
  // without this the wait below can only end on the timeout, and a clip the CDN
  // has lost costs the reader the full `PLAYABLE_WAIT_MS` before `play()`
  // rejects and reports it.
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
 * Build a media element that starts downloading right away.
 *
 * `preload` is set before `src` and set explicitly: the default is the user
 * agent's choice, and a browser that picks `metadata` fetches a header, stops,
 * and leaves the whole download standing between the reader and the first
 * sound -- which is the delay everything here exists to move off the play.
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

/**
 * Speeds the rate menu offers, in the order they are listed.
 *
 * Numeric order because the menu is read rather than stepped through -- every
 * rate is one click away, so there is nothing to gain by putting the slow ones
 * first, and a list that is not in order is harder to scan. Centred on 1x and
 * kept short: the useful range for hearing a line is a little either side of
 * normal, and the reader is picking this off a bar with five other controls.
 */
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

  // Only the two playback preferences. The rest of this store is a live
  // session -- restoring a playlist or a half-played element into a fresh tab
  // would resurrect a player the reader never opened.
  //
  // Re-normalized after hydration because what comes back is whatever is in
  // localStorage, which a reader can hand-edit and an older build may have
  // written in another shape.
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
        this.playCurrent();
      } else if (this.autoplay) {
        this.next();
      } else {
        this.isPlaying = false;
      }
    },

    trackPlay() {
      const posthog = usePostHog();
      posthog?.capture('segment_played', {
        media_id: this.currentResult?.media.publicId,
        media_name: this.currentResult?.media.nameRomaji,
        segment_id: this.currentResult?.segment.publicId,
        playlist_position: this.currentIndex,
        is_autoplay: this.autoplay,
      });

      // Deliberate plays only. `this.autoplay` is the same flag the event above
      // carries, so the counter and the analytics agree on what a play is.
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
     * Start `audio` under a fresh playback token, holding the first sound back
     * until the clip has buffered enough to run to its end.
     *
     * Resolves/rejects that arrive after a newer playback took over are discarded.
     */
    startAudio(audio: HTMLAudioElement, track: boolean) {
      const token = ++playbackToken;

      const started = () => {
        if (token !== playbackToken) return;
        this.isPlaying = true;
        if (track) this.trackPlay();
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

      // Nothing buffered yet. A browser starts a clip as soon as it believes it
      // can keep going, not when the download is done, so on a cold fetch the
      // opening plays into a stall and the reader hears the first syllable of
      // the line chopped.
      //
      // What that needs is a play() after `canplaythrough`, and a play() issued
      // after an await has left the tap's gesture window -- which iOS refuses,
      // with a NotAllowedError this store deliberately drops, so the clip would
      // never play and never report why. So the element is played once here,
      // inside the gesture, and paused again in the same breath: nothing is
      // audible (a play() below HAVE_FUTURE_DATA makes no sound at all, and the
      // pause lands before it could), the download carries on regardless, and
      // WebKit has seen the gesture-initiated play that lifts the restriction
      // from this element for the real play() below.
      //
      // Paused rather than muted, which is the other way to hold an element
      // quiet and is worse twice over: unmuting without a gesture is grounds
      // for iOS to pause the media outright, which would strand autoplay
      // between tracks, and a muted element still reaches the end of a short
      // clip -- `ended` would advance the playlist past a line nobody heard.
      const resumeAt = audio.currentTime;
      // Swallowed whole, and it does not touch `isPlaying`.
      //
      // The `pause()` on the next line is what rejects this, as an AbortError,
      // and it does so deterministically: the rejection is queued immediately
      // while the handover below cannot arrive before `canplaythrough`, which
      // is the wait this path exists for. Clearing `isPlaying` here therefore
      // fired on *every* cold clip, leaving the transport reading "play" for
      // the whole hold -- and, being the one settlement path here with no token
      // guard, it could also clear the flag on a newer clip that had already
      // started while this rejection was still in flight.
      //
      // Nothing is lost by staying quiet: `whenPlayable` always settles, so the
      // real attempt at the handover reports through `failed` either way.
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

    playCurrent() {
      this.releaseAudio();

      const result = this.currentResult;
      if (!result) {
        playbackToken++;
        return;
      }

      const yt = useYoutubeSegmentPlayer();

      if (isYoutube(result)) {
        playbackToken++;
        const seg = result.segment;
        yt.play(seg.publicId, seg.externalVideoId ?? '', seg.startTimeMs, seg.endTimeMs, () => this.handleEnded());
        yt.setVolume(this.volume);
        yt.setPlaybackRate(this.playbackRate);
        this.isPlaying = true;
        this.trackPlay();
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
      // NOT `crossOrigin = 'anonymous'`, tempting as it looks. It would make this
      // a CORS request whose cached response `concatenateAudios` could reuse,
      // removing the re-download `fetchAudioSegment` costs -- and since the CDN
      // now answers `Access-Control-Allow-Origin: *` (brigadasos-infra,
      // cloudflare-r2.tf, 2026-08-13) it would no longer break non-production
      // origins the way it once would have.
      //
      // It stays off anyway, because of what it couples together: with it set,
      // whether ANY audio plays at all depends on that policy staying permissive,
      // and a future "let's tighten CORS" would take playback down site-wide
      // rather than degrade one feature. The retry costs ~17KB on an expansion
      // that follows a play, and fails in a way that is confined to expansion.

      this.startAudio(audio, true);

      audio.onended = () => this.handleEnded();

      this.prefetchNext();
    },

    /**
     * Download the clip after this one while this one plays.
     *
     * The hold `startAudio` puts on the first sound lasts exactly as long as the
     * download does, so the way to make it cost nothing is to have the download
     * already done. A playlist gives us a whole segment's worth of time to do
     * that, and only ever one clip ahead: readers skip, and a queue of elements
     * downloading segments nobody reaches is bandwidth taken from the one they
     * are listening to.
     *
     * Nothing is prefetched for a YouTube segment, which streams through its own
     * player rather than through a media element here.
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

      // An expansion is already here. Its source is a blob the browser built in
      // this tab, so there is no request to get ahead of -- and prefetching it
      // is not merely pointless but costly: the element would hold a second
      // decoded copy of audio that is already ~1.7MB of PCM in memory, to save
      // nothing. Dropped rather than kept, so a stale plain-clip prefetch does
      // not outlive the segment it was for.
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
        this.startAudio(this.currentAudio, false);
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
     * Report where the volume slider was let go.
     *
     * Separate from `setVolume` because that one fires on every step of a drag;
     * this is bound to the slider's `change` instead, so one adjustment is one
     * event. Captured at all because the control was added on the argument that
     * normalization would make it redundant -- this is the number that says
     * whether it did.
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
        this.startAudio(this.currentAudio, false);
        this.isPlaying = true;
      } else if (this.currentResult) {
        this.playCurrent();
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
