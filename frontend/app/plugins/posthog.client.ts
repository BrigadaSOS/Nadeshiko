import type { CaptureResult } from 'posthog-js';
import { createExceptionDeduper, exceptionSignature } from '~/utils/exceptionDedupe';
import { isUnactionableException } from '~/utils/exceptionNoise';
import { posthog, startPostHog } from '~/utils/posthogClient';

/**
 * Loads posthog-js off the critical path and wires everything `@posthog/nuxt`'s
 * own client plugin used to.
 *
 * That plugin is stripped in `nuxt.config.ts` (see the `app:resolve` hook there,
 * which fails the build if it ever stops matching) because it imports posthog-js
 * statically, which put 99,765 B brotli into the entry chunk -- 53.9% of the
 * 185,156 B the browser had to fetch, parse and run before the app could hydrate
 * (measured 2026-08-23, production build, search page). The bytes are not
 * avoidable: `capture_pageview: true` needs the SDK on every load. Their place
 * in the dependency graph is.
 *
 * The import starts HERE, in plugin setup, rather than at `app:mounted` or on an
 * idle callback. Starting it later would widen the window for no additional
 * benefit -- an unawaited dynamic import already costs hydration nothing -- and
 * the two things sensitive to the delay both want it short: posthog-js captures
 * its own `$pageview` inside `init()`, and a reader who leaves before then is
 * not counted. That number is load-bearing; the gap between `$pageview` and
 * `page_engaged` is how scraper traffic is measured (see
 * `engagedPageview.client.ts`).
 *
 * Everything captured before the chunk lands is queued by `~/utils/posthogClient`
 * and replayed in order, so the deferral costs no events. The error bridge below
 * is what extends that guarantee to throws nobody explicitly reported.
 */
export default defineNuxtPlugin({
  name: 'posthog',
  setup(nuxtApp) {
    // Read through a cast, not the generated runtime-config types: those keys
    // exist only when `@posthog/nuxt` is in `modules`, which is production only,
    // so naming them directly would fail to typecheck on every other build.
    const publicConfig = useRuntimeConfig().public as Record<string, unknown>;
    const common = publicConfig.posthog as { publicKey?: string; host?: string; debug?: boolean } | undefined;
    const clientConfig = (publicConfig.posthogClientConfig ?? {}) as Record<string, unknown>;
    const publicKey = common?.publicKey;

    // No module, no key, nothing to load. `isAnalyticsEnabled()` stays false and
    // every capture in the app is a cheap no-op, which is what dev and staging
    // want -- the SDK would only fail against their CSP.
    if (!publicKey) return;

    // A load the backend has already judged to be a machine rather than a reader
    // -- see `classifyHit` in `services/email/returnLink`.
    //
    // WHY THE SUPPRESSION HAPPENS HERE AND NOT AT THE REDIRECT. Mail scanners
    // fetch every link in a message, and these ones run a real Chrome: they
    // follow the 302, execute this app, and each render arrives as a fresh
    // browser profile with its own anonymous device id. Eighteen of them became
    // eighteen PostHog people off a single night's send. Refusing them the
    // redirect is not an option -- a misjudged reader would get a blank page
    // from the one email whose whole purpose is that they came back -- so they
    // are allowed through and simply never given an SDK to be counted by.
    //
    // Returning before `startPostHog` leaves `isAnalyticsEnabled()` false, which
    // takes `page_engaged` out with it. That matters: this population dwells
    // long enough to claim the engaged gate (2.4-5.2s observed), so leaving it
    // armed would file a scanner as an engaged reader -- the exact reading that
    // metric exists to prevent.
    if (analyticsSuppressed()) return;

    // Installed before the import is even requested. `vue:error` is the hook the
    // module used to own, and it catches errors thrown during hydration --
    // exactly the window this plugin opens up. The capture goes through the
    // stub, so it is queued and delivered rather than lost.
    const capturesExceptions = captureExceptionsEnabled(clientConfig);
    let stopErrorBridge = () => {};

    if (capturesExceptions) {
      nuxtApp.hook('vue:error', (error, _target, info) => {
        posthog.captureException(error, { info });
      });
      stopErrorBridge = installLoadWindowErrorBridge();
    }

    startPostHog(async () => {
      try {
        const { default: client } = await import('posthog-js');

        client.init(publicKey, {
          api_host: common?.host,
          ...clientConfig,
          /**
           * Passed to `init` rather than `set_config`-ed afterwards by a
           * separate plugin, which is where this lived until the SDK became
           * async: a `before_send` installed by a later plugin was only ever
           * ahead of the first exception because init was synchronous. It
           * cannot be a `posthogConfig` entry either -- the module serialises
           * client config into `runtimeConfig.public`, where functions do not
           * survive -- so this is the earliest place it can go, and now the only
           * one that is provably early enough.
           *
           * Drops the second copy of every double-captured `$exception` (see
           * `~/utils/exceptionDedupe` for why there are two), and the
           * autocaptured ones that were never faults (see
           * `~/utils/exceptionNoise`).
           */
          before_send: buildBeforeSend(),
        });

        if (common?.debug) client.debug(true);

        return client;
      } finally {
        // After `init`, so posthog-js's own global handlers are already in place
        // and nothing is uncovered between the two. Also on the failure path: a
        // client that is not coming is no reason to keep listening.
        stopErrorBridge();
      }
    });

    // Always the stub, never the client itself: it proxies through to posthog-js
    // once that exists, so a `usePostHog()` resolved at setup -- which
    // `useSegmentConcatenation` and the player store both do, because
    // `useNuxtApp()` throws once the stack has passed an await -- is not frozen
    // on the pre-load stub for the life of the page.
    return { provide: { posthog: () => posthog } };
  },
});

/**
 * The `before_send` posthog-js is initialised with, over a deduper that lives as
 * long as the page.
 *
 * One function rather than the array posthog-js also accepts: the two rules have
 * to run in this order -- dropping the noise first means the deduper never
 * records a signature for an event that is not being sent, so it cannot expire
 * a later real one -- and composing them here states that, where an array leaves
 * it to the SDK's iteration order.
 */
function buildBeforeSend(): (event: CaptureResult | null) => CaptureResult | null {
  const isDuplicate = createExceptionDeduper();

  return (event) => {
    if (event?.event !== '$exception') return event;

    if (isUnactionableException(event.properties)) return null;

    const signature = exceptionSignature(event.properties);
    if (!signature) return event;

    return isDuplicate(signature, Date.now()) ? null : event;
  };
}

/**
 * Whether posthog-js will install its own `onerror`/`onunhandledrejection`
 * handlers, which is the same flag that decided whether the module hooked
 * `vue:error`. Kept identical to the module's own test so the two paths the
 * deduper exists to reconcile still turn on and off together.
 */
function captureExceptionsEnabled(config: Record<string, unknown>): boolean {
  const value = config.capture_exceptions;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'object' && value !== null) {
    return (value as { capture_unhandled_errors?: boolean }).capture_unhandled_errors === true;
  }
  return false;
}

/**
 * Catches unhandled throws between this plugin and `init()`, then gets out of
 * the way.
 *
 * posthog-js installs its global handlers inside `init`, so deferring init leaves
 * them absent for the length of the load window -- and an error in that window
 * is, on a cold load, precisely a hydration error. This restores the coverage
 * the synchronous init had, and no more: the listeners come off as soon as the
 * SDK is up, so they cannot double-report against posthog-js's own handlers, and
 * the deduper would collapse it if they somehow did.
 *
 * `event.error` absent means a subresource failed to load (an image 404, a
 * blocked script), not a throw. Those fire on `window` too and are not
 * exceptions; capturing them would file every ad-blocked request as an error.
 *
 * @returns a function that removes both listeners.
 */
function installLoadWindowErrorBridge(): () => void {
  const onError = (event: ErrorEvent) => {
    if (!event.error) return;
    posthog.captureException(event.error);
  };
  const onRejection = (event: PromiseRejectionEvent) => {
    posthog.captureException(event.reason);
  };

  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onRejection);

  return () => {
    window.removeEventListener('error', onError);
    window.removeEventListener('unhandledrejection', onRejection);
  };
}

/**
 * Whether this load was marked as machine traffic by the email redirect.
 *
 * Read straight off `location` rather than through the router, because this runs
 * in plugin setup before a route is resolved -- and because the only thing that
 * sets it is a server-issued `Location` header, which is a full navigation.
 *
 * The name is `ANALYTICS_SUPPRESSED_PARAM` on the other side of the wire
 * (`backend/app/services/email/returnLink.ts`). Two packages, no shared
 * constant: change one and this stops working silently, so change both.
 */
function analyticsSuppressed(): boolean {
  try {
    return new URLSearchParams(window.location.search).get('nb') === '1';
  } catch {
    // A `location` we cannot parse is not a reason to stop counting anybody.
    return false;
  }
}
