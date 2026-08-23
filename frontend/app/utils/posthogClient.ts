import type posthogJs from 'posthog-js';

/**
 * The posthog-js the app talks to, which is a stand-in until the real one lands.
 *
 * WHY THIS EXISTS. `@posthog/nuxt`'s client plugin does `import posthog from
 * "posthog-js"` at module scope, so the SDK sat in the entry chunk: 99,765 B
 * brotli of a 185,156 B entry graph -- 53.9% of everything hydration waits on,
 * and 314KB of script to parse and execute before the app mounts (measured
 * 2026-08-23 on a production build of the search page, whose 60 JS files total
 * 347,731 B). It is not optional bytes either: `capture_pageview: true` means
 * every page load needs it. What it does not need is to need it FIRST.
 *
 * So `plugins/posthog.client.ts` replaces the module's plugin with a dynamic
 * `import('posthog-js')` and hands the result to `startPostHog` below. In the
 * window between the plugin running and the chunk landing there is no SDK, and
 * this module is what stands in its place: every call is queued and replayed, in
 * order, the moment `init()` returns. NOTHING IS DROPPED IN THAT WINDOW -- which
 * matters most for `$exception`, now that PostHog is the only place errors go
 * (Grafana Faro was removed 2026-08-23).
 *
 * Once the SDK is here the proxy forwards straight through to it, so a reference
 * taken during the window -- `const posthog = usePostHog()` resolved at setup, a
 * pattern several composables rely on -- keeps working with the full API rather
 * than being stuck on the stub for the life of the page.
 *
 * Reads are the one thing that cannot be deferred: `get_distinct_id()` and
 * friends must answer NOW or not at all, so before the SDK lands they answer
 * `undefined`. That is the same answer they gave when the guard was
 * `posthog.__loaded`, but the window is wider now, so a caller that needs a real
 * one has to wait for `onPostHogReady`. `useAnalyticsIdentity` is the only one
 * that does.
 */
type PostHog = typeof posthogJs;

/** A call made before posthog-js arrived, ready to be replayed against it. */
type QueuedCall = (posthog: PostHog) => void;

/**
 * How many deferred calls are held before new ones are dropped.
 *
 * A bound rather than trust: if the chunk never arrives -- a content blocker,
 * an offline reload, a CDN 404 after a deploy -- `startPostHog` clears the queue
 * on the failure and nothing accumulates. This covers the other shape, where the
 * import simply never settles, and keeps a page that is throwing in a loop from
 * growing an unbounded array of closures over its own Error objects. A load
 * window is tens to hundreds of milliseconds; 200 events in it is already far
 * past anything real.
 */
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

/**
 * The page a deferred call was made on, stamped onto the event so replaying it
 * later cannot misattribute it.
 *
 * posthog-js fills `$current_url` and `$pathname` from `window.location` at the
 * moment of capture, and properties passed by the caller take precedence over
 * the ones it collects -- which is the documented way to correct a URL. Without
 * this, an event captured on `/search/手加減` and replayed after the reader has
 * already moved on would be filed against wherever they went.
 */
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
   * Timestamped by when the SDK arrived rather than when the throw happened:
   * `captureException` takes properties but no `CaptureOptions`, so there is no
   * timestamp to override. The skew is one load window, which is the wrong
   * trade only if sub-second exception ordering matters more than the exception
   * existing at all.
   */
  captureException(error: unknown, properties?: Record<string, unknown>) {
    const page = pageProperties();
    defer((posthog) => posthog.captureException(error, { ...page, ...properties }));
    return undefined;
  },

  identify(distinctId?: string, setProperties?: Record<string, unknown>, setOnce?: Record<string, unknown>) {
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
 * The client, whether or not it has arrived.
 *
 * A proxy and not a plain object for two reasons. It forwards wholesale to the
 * real SDK once loaded, so nothing is limited to the members stubbed above for
 * the rest of the page; and a member that is NOT stubbed, called during the load
 * window, is queued rather than thrown. The second is the one that matters in
 * six months: this stub knows about the nine members ~60 call sites use today,
 * and the next call site added should lose an event at worst, never take the
 * page down with "posthog.getFeatureFlag is not a function".
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
 * Whether analytics exist on this build at all.
 *
 * True from the moment the plugin starts the import, NOT from when it finishes:
 * callers use this to decide whether to bother, and "not yet" is a yes -- the
 * call will be queued. Outside production the module is absent, nothing starts
 * it, and this stays false so every capture is a cheap no-op.
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
 * Runs once there is a real client, immediately if there already is one.
 *
 * For the callers that need posthog-js to ANSWER rather than merely record --
 * `useAnalyticsIdentity` reads `get_distinct_id()` and `get_property()` to decide
 * whether to `reset()` before identifying, and getting `undefined` there would
 * strand every reader still on the old display-name distinct id.
 *
 * Never runs outside production, where nothing starts the client.
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
