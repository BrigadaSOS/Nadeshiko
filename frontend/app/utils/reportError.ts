import { faro } from '@grafana/faro-web-sdk';
import posthog from 'posthog-js';
import { getPagePath } from '~/utils/pagePath';

function toError(value: unknown): Error {
  if (value instanceof Error) return value;
  return new Error(typeof value === 'string' ? value : 'Unknown error');
}

export interface ReportErrorOptions {
  /**
   * Report to Faro only. For errors PostHog already records through one of its own
   * handlers, so this does not add a second copy of the same throw.
   */
  faroOnly?: boolean;
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
export function reportError(
  name: string,
  error: unknown,
  attributes?: Record<string, string>,
  options: ReportErrorOptions = {},
): void {
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

  // Not `usePostHog()`: that resolves through `useNuxtApp()`, which throws whenever
  // this is reached from a detached async catch — the common case here — so every
  // such capture was silently swallowed and PostHog only ever saw what its own
  // handlers caught. The singleton needs no Nuxt context.
  if (!options.faroOnly && posthog.__loaded) {
    posthog.captureException(normalized, { error_source: name, ...attributes });
  }
}
