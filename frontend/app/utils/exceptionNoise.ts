/**
 * Filter serialized exceptions seen by both explicit and automatic capture paths. Add only rules that
 * identify noise regardless of throw site.
 */

interface ExceptionListEntry {
  type?: unknown;
  value?: unknown;
}

/**
 * Cloudflare's managed challenge can reject a Nuxt navigation before the app's
 * search composable receives a Response. Keep that edge interruption out of the
 * application issue list; the API-side search path already emits
 * `search_fetch_failed` with scope and status when it can observe the failure.
 */
export function isCloudflareChallengeException(properties: Record<string, unknown> | undefined): boolean {
  if (!properties || properties.$exception_fingerprint) return false;

  const list = properties.$exception_list;
  const first = Array.isArray(list) ? (list[0] as ExceptionListEntry | undefined) : undefined;
  const value = typeof first?.value === 'string' ? first.value : '';
  const currentUrl = typeof properties.$current_url === 'string' ? properties.$current_url : '';
  const referrer = typeof properties.$referrer === 'string' ? properties.$referrer : '';
  const context = `${value} ${currentUrl} ${referrer}`;

  return /HTTP error 403/i.test(value) && /(?:^|\/)search(?:\/|\?|$)/i.test(context) && /__cf_chl_tk/i.test(context);
}

/**
 * Match reader/UA-declined actions only as DOMExceptions, in step with playback filtering; app errors with
 * the same names must still report.
 */
const UNACTIONABLE_DOM_EXCEPTIONS = ['AbortError', 'NotAllowedError'];

/** Suppress known ResizeObserver scheduling noise; reconsider if app observers introduce resize-feedback loops.
 * Keep both browser message variants.
 */
const RESIZE_OBSERVER_NOTICES = [
  'ResizeObserver loop completed with undelivered notifications',
  'ResizeObserver loop limit exceeded',
];

/**
 * Match extension-owned identifiers rather than engine-specific message wording. Keep the list narrow enough
 * not to collide with application code.
 */
const EXTENSION_GLOBALS = ['migakuCoreApiReceive'];

/**
 * Never drop deliberate reports marked by `$exception_fingerprint`; only autocaptured events are candidates
 * for noise filtering.
 */
export function isUnactionableException(properties: Record<string, unknown> | undefined): boolean {
  if (!properties) return false;
  if (properties.$exception_fingerprint) return false;

  const list = properties.$exception_list;
  if (!Array.isArray(list) || list.length === 0) return false;

  const first = list[0] as ExceptionListEntry | undefined;
  const type = typeof first?.type === 'string' ? first.type : '';
  const value = typeof first?.value === 'string' ? first.value : '';

  if (RESIZE_OBSERVER_NOTICES.some((notice) => value.includes(notice))) return true;

  if (EXTENSION_GLOBALS.some((name) => value.includes(name))) return true;

  // posthog-js serialises a DOMException with the class as `type` and
  // `${name}: ${message}` as `value`, so the name is a prefix of the value and
  // not a field of its own. Anchored at the start rather than searched for, so
  // an unrelated message that quotes one of these names does not match.
  if (type === 'DOMException') {
    return UNACTIONABLE_DOM_EXCEPTIONS.some((name) => value.startsWith(`${name}:`));
  }

  return false;
}
