import { faro } from '@grafana/faro-web-sdk';
import { getPagePath } from '~/utils/pagePath';

function toError(value: unknown): Error {
  if (value instanceof Error) return value;
  return new Error(typeof value === 'string' ? value : 'Unknown error');
}

/**
 * Report a handled error to the observability pipeline (Faro exceptions + PostHog
 * error tracking) instead of dropping it on the floor with `console.error`.
 *
 * `name` is a stable identifier for the failing operation (`player:audio-play-failed`)
 * and becomes the grouping key on both destinations — keep it greppable and don't
 * interpolate variable data into it.
 *
 * Falls back to `console.error` on the server and before Faro boots (no `faroUrl`
 * configured, or the plugin hasn't run yet).
 */
export function reportError(name: string, error: unknown, attributes?: Record<string, string>): void {
  if (!import.meta.client || !faro.api) {
    console.error(`[${name}]`, error);
    return;
  }

  const normalized = toError(error);

  faro.api.pushError(normalized, {
    type: name,
    context: {
      'page.path': getPagePath(),
      'browser.url': window.location.href,
      ...attributes,
    },
  });

  try {
    usePostHog()?.captureException(normalized, { error_source: name, ...attributes });
  } catch {
    // Called from an async catch block that lost the Nuxt context. Faro already
    // has the error, so there is nothing to recover here.
  }
}
