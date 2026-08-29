import { posthog, isAnalyticsEnabled } from '~/utils/posthogClient';
import { getPagePath } from '~/utils/pagePath';

function toError(value: unknown): Error {
  if (value instanceof Error) return value;
  return new Error(typeof value === 'string' ? value : 'Unknown error');
}

/**
 * Report a handled error to PostHog error tracking instead of dropping it on the
 * floor with `console.error`.
 *
 * `name` is a stable identifier for the failing operation (`player:audio-play-failed`)
 * and becomes the grouping key — keep it greppable and don't interpolate variable
 * data into it.
 *
 * GRAFANA FARO WAS THE SECOND DESTINATION UNTIL 2026-08-23, and every signal it
 * carried is now collected somewhere better. PostHog was already receiving all of
 * this: 2,628 `$exception` events in the fortnight to that date, all from
 * nadeshiko.co, with `error_source` populated exactly as set below. The one thing
 * Faro uniquely had was TTFB, which `plugins/rum.client.ts` still reports -- to
 * PostHog now, on the `$web_vitals` event beside the four PostHog autocaptures
 * itself -- and browser traces, which were accepted as lost.
 *
 * Falls back to `console.error` on the server and on builds with no analytics.
 */
export function reportError(name: string, error: unknown, attributes?: Record<string, string>): void {
  // Not `usePostHog()`: that resolves through `useNuxtApp()`, which throws whenever
  // this is reached from a detached async catch — the common case here — so every
  // such capture was silently swallowed and PostHog only ever saw what its own
  // handlers caught. `~/utils/posthogClient` is a module-scope singleton and
  // needs no Nuxt context either.
  //
  // The test is `isAnalyticsEnabled()` and NOT `posthog.__loaded`, and that
  // difference is the whole reason an error thrown during page load still
  // arrives. posthog-js is fetched asynchronously now, so `__loaded` is false
  // for the first stretch of every load — which would have sent exactly the
  // errors most worth having to the console instead. Captures made before the
  // SDK lands are queued and replayed in order once it does; this guard is
  // only about builds where no SDK is coming at all.
  if (!import.meta.client || !isAnalyticsEnabled()) {
    console.error(`[${name}]`, error);
    return;
  }

  const normalized = toError(error);

  posthog.captureException(normalized, {
    error_source: name,
    // Carried over from the Faro context, which had them and PostHog did not.
    'page.path': getPagePath(),
    'browser.url': window.location.href,
    // Without this, PostHog derives its own fingerprint from the exception type
    // and stack -- and these reports are mostly async rejections whose stacks
    // are empty or identically minified, so unrelated faults COLLIDE. A real
    // one: `segment:audio-concatenation-failed` (a bare `TypeError: Failed to
    // fetch`) landed on the same fingerprint as the stale-chunk import errors,
    // leaving one issue that was two bugs and whose status and last-seen
    // described neither. `name` is already the stable identifier for the
    // failing operation, so it is what should decide grouping.
    $exception_fingerprint: name,
    ...attributes,
  });
}

/**
 * Count something that went wrong without filing it as an error.
 *
 * The distinction is the whole point of this function existing: PostHog's issue
 * list should stay about faults with a fix, while a fault that is somebody
 * else's network is still worth a number. Faro used to be where those went --
 * one more exception in a stream nobody triaged -- and when it was removed
 * (2026-08-23) they needed somewhere that was not the issue list.
 *
 * Guarded exactly like `reportError` above, and for the same reason: callers
 * reach this from detached async catches where `useNuxtApp()` throws.
 */
export function reportEvent(name: string, properties?: Record<string, string>): void {
  if (!import.meta.client || !isAnalyticsEnabled()) return;
  posthog.capture(name, properties);
}
