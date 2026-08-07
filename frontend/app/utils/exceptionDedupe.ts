/**
 * Collapses the duplicate `$exception` events PostHog records for a single throw.
 *
 * Two independent PostHog paths capture the same error: `@posthog/nuxt` hooks
 * `vue:error` and calls `captureException` (recorded handled), while posthog-js's
 * own `capture_exceptions` autocapture catches the same throw through
 * `onerror`/`onunhandledrejection` (recorded unhandled). Both are wanted in
 * isolation — one covers errors Vue swallows, the other covers everything outside
 * Vue — but an async rejection that Vue also sees trips both and lands twice,
 * roughly doubling the occurrence count on the affected issues.
 *
 * The module gates its hook on the same `capture_exceptions` flag that drives the
 * global handlers, so there is no config that separates them. Deduping the events
 * themselves is what is left.
 */

/**
 * Duplicates land within a few tens of milliseconds of each other, so the window
 * stays short: a genuine re-throw of the same error is far more likely to be real
 * signal than noise once it is this far apart.
 */
export const EXCEPTION_DEDUPE_WINDOW_MS = 500;

interface ExceptionListEntry {
  type?: unknown;
  value?: unknown;
}

/**
 * Builds a stable key for an exception event, or `null` when the event carries
 * nothing identifying (in which case it should pass through untouched).
 */
export function exceptionSignature(properties: Record<string, unknown> | undefined): string | null {
  if (!properties) return null;

  const list = properties.$exception_list;
  if (Array.isArray(list) && list.length > 0) {
    const first = list[0] as ExceptionListEntry | undefined;
    const type = typeof first?.type === 'string' ? first.type : '';
    const value = typeof first?.value === 'string' ? first.value : '';
    if (type || value) return `${type}|${value}`;
  }

  // Older/synthetic payloads only carry the flattened arrays.
  const values = properties.$exception_values;
  if (Array.isArray(values) && values.length > 0) {
    return values.map((entry) => (typeof entry === 'string' ? entry : '')).join('|');
  }

  return null;
}

/**
 * Returns a predicate that reports whether a signature was already seen inside the
 * window. Entries are pruned on each call, so the map stays bounded by how many
 * distinct errors fire within a single window rather than by session length.
 */
export function createExceptionDeduper(windowMs: number = EXCEPTION_DEDUPE_WINDOW_MS) {
  const seen = new Map<string, number>();

  return function isDuplicate(signature: string, now: number): boolean {
    for (const [key, seenAt] of seen) {
      if (now - seenAt >= windowMs) seen.delete(key);
    }

    const previous = seen.get(signature);
    seen.set(signature, now);

    return previous !== undefined && now - previous < windowMs;
  };
}
