import { NadeshikoError, type NadeshikoErrorCode } from '@brigadasos/nadeshiko-sdk';
import { reportError } from '~/utils/reportError';
import { useToastError } from '~/utils/toast';

export interface HandleApiErrorOptions {
  /**
   * i18n key for the user-facing toast. When omitted, a generic message keyed
   * by the error code family is used. Pass `false` to suppress the toast for
   * flows that render the failure inline instead.
   */
  toastKey?: string | false;
  /** Extra context forwarded to the error pipeline (PostHog). */
  context?: Record<string, string>;
  /** Codes the caller handles itself; matching errors are rethrown untouched. */
  rethrow?: NadeshikoErrorCode[];
}

/**
 * Single funnel for failed API calls: reports through the observability
 * pipeline (with `code` and `traceId` when the backend provided them) and
 * surfaces a translated toast. Returns the normalized details so callers can
 * still branch on `code` for inline UI states.
 */
export function handleApiError(source: string, err: unknown, options: HandleApiErrorOptions = {}) {
  const known = err instanceof NadeshikoError ? err : null;
  if (known && options.rethrow?.includes(known.code)) {
    throw err;
  }

  reportError(source, err, {
    ...options.context,
    ...(known
      ? { code: known.code, status: String(known.status), ...(known.traceId ? { traceId: known.traceId } : {}) }
      : {}),
  });

  // Most callers reach this from an async catch block, where the Nuxt context is
  // no longer guaranteed. Reporting above always runs; the toast is best-effort.
  const nuxtApp = options.toastKey === false ? null : tryUseNuxtApp();
  if (nuxtApp) {
    const fallbackKey = known?.status === 429 ? 'errors.rateLimited' : 'errors.generic';
    useToastError(nuxtApp.$i18n.t(options.toastKey || fallbackKey));
  }

  return known;
}

/**
 * Read status structurally: symlinked SDK source can produce separate client/server class identities, making
 * `instanceof` unreliable during SSR. Undefined means no status is available.
 */
export function apiErrorStatus(err: unknown): number | undefined {
  if (typeof err !== 'object' || err === null) return undefined;
  const candidate = err as { status?: unknown; statusCode?: unknown };
  if (typeof candidate.status === 'number') return candidate.status;
  if (typeof candidate.statusCode === 'number') return candidate.statusCode;
  return undefined;
}

/**
 * Treat 400/404 as missing only when the URL id is the entire input: malformed ids fail validation before
 * lookup. Do not use this rule for calls with request bodies.
 */
export function isMissing(status: number | undefined): boolean {
  return status === 404 || status === 400;
}
