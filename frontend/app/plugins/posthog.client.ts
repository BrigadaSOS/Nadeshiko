import type { CaptureResult } from 'posthog-js';
import { createExceptionDeduper, exceptionSignature } from '~/utils/exceptionDedupe';
import { isCloudflareChallengeException, isUnactionableException } from '~/utils/exceptionNoise';
import { posthog, startPostHog } from '~/utils/posthogClient';

/**
 * Replace the module's static SDK import with an unawaited dynamic load, started during setup to minimize
 * lost short visits. The proxy queues captures until init; install error coverage before starting the import.
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
    const appVersion = typeof publicConfig.appVersion === 'string' ? publicConfig.appVersion : undefined;

    // No module, no key, nothing to load. `isAnalyticsEnabled()` stays false and
    // every capture in the app is a cheap no-op, which is what dev and staging
    // want -- the SDK would only fail against their CSP.
    if (!publicKey) return;

    // Email scanners may execute the redirected page in fresh browser profiles. Let them reach the page, but
    // do not start analytics: withholding the SDK also disables engaged-view counting.
    if (analyticsSuppressed()) return;

    // Install error coverage before requesting the SDK so hydration failures enter the deferred queue.
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
           * Install `before_send` during init, before any automatic event. Functions cannot survive
           * serialized runtime config. Filter exception noise before recording dedupe signatures.
           */
          before_send: buildBeforeSend(appVersion),
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

    // Provide the stable proxy so composables holding a setup-time reference keep working after the SDK
    // loads.
    return { provide: { posthog: () => posthog } };
  },
});

/** Filter noise before deduplication so a discarded event cannot suppress a later real exception. */
function buildBeforeSend(appVersion?: string): (event: CaptureResult | null) => CaptureResult | null {
  const isDuplicate = createExceptionDeduper();

  return (event) => {
    // Enrich inside `before_send`, which also sees the automatic pageview
    // emitted by `init`. Calling `register` after init would leave that first
    // event without the deploy anchor used during regression triage.
    if (event && appVersion) {
      event.properties = { ...event.properties, $app_version: appVersion };
    }

    if (event?.event !== '$exception') return event;

    if (isCloudflareChallengeException(event.properties)) {
      posthog.capture('cloudflare_challenge_blocked', {
        'edge.reason': 'managed_challenge',
        'page.path': event.properties?.$pathname ?? event.properties?.$current_url,
      });
      return null;
    }
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
 * Bridge global errors until init installs the SDK handlers. Ignore error events without `event.error`, which
 * represent subresource failures rather than throws.
 * @returns Cleanup for both temporary listeners.
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
 * Read the redirect's machine-traffic marker directly from location before route resolution. Keep `nb`
 * synchronized with backend `ANALYTICS_SUPPRESSED_PARAM`; there is no shared constant.
 */
function analyticsSuppressed(): boolean {
  try {
    return new URLSearchParams(window.location.search).get('nb') === '1';
  } catch {
    // A `location` we cannot parse is not a reason to stop counting anybody.
    return false;
  }
}
