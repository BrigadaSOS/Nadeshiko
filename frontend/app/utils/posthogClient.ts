import type posthogJs from 'posthog-js';

/**
 * Stable PostHog proxy while the SDK loads dynamically. Queue writes in order and forward existing references
 * to the real client after init. Reads return undefined until ready; callers needing identity values must use
 * `onPostHogReady`.
 */
type PostHog = typeof posthogJs;

/** A call made before posthog-js arrived, ready to be replayed against it. */
type QueuedCall = (posthog: PostHog) => void;

/** Bound queued closures if SDK loading never settles; failed loading clears the queue. */
export const DEFERRED_CALL_LIMIT = 200;

let loaded: PostHog | null = null;
/** Whether an SDK is coming at all. False outside production, where the module
 *  is not installed and every call below is a no-op rather than a queue. */
let starting = false;
let deferred: QueuedCall[] = [];
let readyCallbacks: Array<(posthog: PostHog) => void> = [];

/** Deferred calls that hit `DEFERRED_CALL_LIMIT`, reported once the SDK is up so
 *  a page that overflowed the queue says so instead of quietly under-counting. */
let droppedCalls = 0;

function defer(call: QueuedCall): void {
  if (loaded) {
    call(loaded);
    return;
  }
  if (!starting) return;
  if (deferred.length >= DEFERRED_CALL_LIMIT) {
    droppedCalls += 1;
    return;
  }
  deferred.push(call);
}

/** Stamp the originating page before deferral so replay after navigation cannot misattribute the event. */
function pageProperties(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  return { $current_url: window.location.href, $pathname: window.location.pathname };
}

/**
 * What the app calls in place of the SDK for the members it actually uses.
 *
 * Only reached while `loaded` is null -- the proxy below forwards everything to
 * the real client once there is one -- so these are the pre-arrival behaviours
 * and nothing else.
 */
const stub = {
  capture(event: string, properties?: Record<string, unknown> | null, options?: { timestamp?: Date }) {
    const at = new Date();
    const page = pageProperties();
    // The caller's own `timestamp` wins, so an event that already knew when it
    // happened is not restamped with when the queue drained.
    defer((posthog) => posthog.capture(event, { ...page, ...properties }, { timestamp: at, ...options }));
    return undefined;
  },

  /**
   * `captureException` has no timestamp option, so deferred exceptions use replay time; page properties still
   * retain their original context.
   */
  captureException(error: unknown, properties?: Record<string, unknown>) {
    const page = pageProperties();
    defer((posthog) => posthog.captureException(error, { ...page, ...properties }));
    return undefined;
  },

  identify(distinctId: string, setProperties?: Record<string, unknown>, setOnce?: Record<string, unknown>) {
    defer((posthog) => posthog.identify(distinctId, setProperties, setOnce));
  },

  reset() {
    defer((posthog) => posthog.reset());
  },

  set_config(config: Record<string, unknown>) {
    defer((posthog) => posthog.set_config(config));
  },

  // The three that cannot be deferred, because a caller wants the answer now.
  get_distinct_id: (): string | undefined => undefined,
  get_session_id: (): string | undefined => undefined,
  get_property: (_property: string): unknown => undefined,

  __loaded: false,
};

/**
 * Forward the full SDK API after loading; unknown methods called before loading are deferred rather than
 * throwing.
 */
export const posthog = new Proxy(stub, {
  get(target, property, receiver) {
    if (loaded) {
      const value = Reflect.get(loaded, property, loaded);
      return typeof value === 'function' ? value.bind(loaded) : value;
    }
    if (property in target) return Reflect.get(target, property, receiver);
    return (...args: unknown[]) =>
      defer((real) => (real as unknown as Record<string, (...a: unknown[]) => unknown>)[property as string]?.(...args));
  },
}) as unknown as PostHog;

/**
 * True once loading starts, not only when it finishes: pending captures can queue. False on builds that never
 * start analytics.
 */
export function isAnalyticsEnabled(): boolean {
  return starting;
}

/**
 * Fetches and initialises posthog-js, then drains everything that happened while
 * it was on its way.
 *
 * @param load Resolves to the initialised client, or null if it could not be
 *             loaded -- a blocked request, a stale chunk after a deploy. Null and
 *             a rejection are treated the same: the queue is released rather than
 *             held for a client that is not coming.
 */
export function startPostHog(load: () => Promise<PostHog | null>): void {
  if (starting) return;
  starting = true;

  load()
    .then((client) => {
      if (!client) {
        deferred = [];
        readyCallbacks = [];
        return;
      }
      loaded = client;

      // Each call in its own try: one queued capture that throws must not strand
      // the rest of the queue behind it, and the whole point of the queue is
      // that what went in comes out.
      for (const call of deferred) {
        try {
          call(client);
        } catch (error) {
          console.error('[posthog:deferred-call-failed]', error);
        }
      }
      deferred = [];

      if (droppedCalls > 0) {
        client.capture('analytics_deferred_overflow', { dropped: droppedCalls });
      }

      for (const callback of readyCallbacks) {
        try {
          callback(client);
        } catch (error) {
          console.error('[posthog:ready-callback-failed]', error);
        }
      }
      readyCallbacks = [];
    })
    .catch((error: unknown) => {
      // Console only, deliberately: the one reporter that could carry this is
      // the thing that just failed to load.
      console.error('[posthog:load-failed]', error);
      deferred = [];
      readyCallbacks = [];
    });
}

/**
 * Run once the SDK can answer identity reads, immediately if loaded. No callback runs when analytics never
 * starts.
 */
export function onPostHogReady(callback: (posthog: PostHog) => void): void {
  if (loaded) {
    callback(loaded);
    return;
  }
  if (!starting) return;
  readyCallbacks.push(callback);
}

export function _resetPostHogClientForTests(): void {
  loaded = null;
  starting = false;
  deferred = [];
  readyCallbacks = [];
  droppedCalls = 0;
}
