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
 * The HTTP status behind a failed call, without relying on class identity.
 *
 * `err instanceof NadeshikoError` is the obvious test and it is not safe here.
 * The SDK is a symlinked workspace package resolving to TypeScript source, so
 * the client graph and the server graph can each end up with their own copy of
 * the class; an error thrown by one copy fails `instanceof` against the other,
 * silently, and only during SSR.
 *
 * That is not hypothetical. Sentence permalinks for deleted or mistyped ids
 * rendered HTTP 500 in production while the API had answered a clean 404 --
 * verified in the access logs, backend 404 and frontend 500 on the same request
 * id -- because the page identified "not found" by class and fell through to
 * its failure branch. Googlebot, bingbot and ChatGPT-User were all served 500s
 * for pages that simply do not exist, and every one of them also arrived in
 * error tracking as a real fault.
 *
 * Reading the status off the object is what `pages/[...slug].vue` already does
 * for the content route. Returns undefined when there is no status to read, so
 * callers still distinguish "the API said no" from "the call never landed".
 */
export function apiErrorStatus(err: unknown): number | undefined {
  if (typeof err !== 'object' || err === null) return undefined;
  const candidate = err as { status?: unknown; statusCode?: unknown };
  if (typeof candidate.status === 'number') return candidate.status;
  if (typeof candidate.statusCode === 'number') return candidate.statusCode;
  return undefined;
}

/**
 * Whether a failed lookup means "no such thing" rather than "we broke".
 *
 * 404 is the obvious half. 400 is the half that got missed, and it left the
 * original bug half-fixed: every public id is `^[A-Za-z0-9_-]{12}$`, validated
 * at the API before the handler runs, so a malformed one comes back 400 without
 * anything ever being looked up. `/es/sentence/13123123123` is eleven digits --
 * it returned 400, fell through to the failure branch, and rendered 500 at a
 * point where the only honest answer was "that is not an address".
 *
 * Sound only where the URL is the entire input to the call, which is the case
 * for these id lookups: nothing else can be malformed, so a 400 cannot be
 * reporting our mistake. Do not reach for this on a call that sends a body.
 */
export function isMissing(status: number | undefined): boolean {
  return status === 404 || status === 400;
}
