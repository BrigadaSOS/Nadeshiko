import { getCookie } from 'h3';
import type { H3Event } from 'h3';
import { RENDER_FORKING_PREFERENCE_COOKIES } from '#shared/utils/preferenceCookies';
import { isPrivatePath } from '#shared/utils/privatePaths';
import { hasSessionCookie } from './ssrAuthCache';

/**
 * Who a rendered page may be stored by.
 *
 * - `shared` — the render is a pure function of the URL. Every visitor in this
 *   tier gets byte-identical HTML, so a shared cache may hold one copy for all
 *   of them. Measured, not assumed: two anonymous requests for the same search
 *   URL differ only in the CSP nonce and the SEO module's `timeSsrStart`.
 * - `browser` — no session, but a preference cookie the server reads has moved
 *   content in or out of the page. Correct for that browser to reuse, never for
 *   a shared cache to hand to anyone else.
 * - `personal` — a session cookie. Login chrome, hidden-media exclusions and
 *   content-rating filters are all baked into the markup.
 *
 * Deliberately decided from the REQUEST, not from what the render turned out to
 * contain: the header has to be settable without waiting on the render, and a
 * cache key that cannot be computed before rendering is not a cache key. It errs
 * pessimistic in one direction only -- a visitor carrying a preference cookie
 * that happens to hold its default value is classified `browser` and simply
 * misses a cache it could have used.
 */
export type VisitorCacheTier = 'shared' | 'browser' | 'personal';

/**
 * The preference cookies whose presence forks the render, as a plain array so
 * the check below stays a cheap loop over four names.
 */
const PREFERENCE_COOKIES: readonly string[] = RENDER_FORKING_PREFERENCE_COOKIES;

/**
 * Whether a path may be stored by a shared cache at all, independent of who is
 * asking.
 *
 * `visitorCacheTier` answers "who is asking"; this answers "what are they asking
 * for", and both have to say yes. A signed-out request to `/en/user/collections`
 * is `shared` by the cookie test and renders a generic signed-out page, so
 * storing it would be *correct* -- but these paths exist to show one reader their
 * own things, and the upside of caching them is nil. That is a bad trade against
 * the chance that any one of them ever renders something for a cookie-less
 * visitor that is not generic.
 *
 * The list lives in `shared/utils/privatePaths.ts`, where `robots` and the
 * `robots: false` route rules read it too.
 */
export const htmlPathIsShareable = (path: string): boolean => !isPrivatePath(path);

export function visitorCacheTier(event: H3Event): VisitorCacheTier {
  // Checked first and on its own: a signed-in reader is `personal` whatever else
  // they carry, and this is the one that must never be wrong.
  if (hasSessionCookie(event)) return 'personal';

  for (const name of PREFERENCE_COOKIES) {
    // An empty value is how `useCookiePreference` stores "back to the default",
    // and a default renders the same as no cookie at all -- so it does not fork
    // anything and must not cost this visitor the shared tier.
    if (getCookie(event, name)) return 'browser';
  }

  return 'shared';
}
