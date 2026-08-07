import { SUPPORTED_LOCALES, type SupportedLocale } from '~/utils/i18n';

// Paths that belong to the app itself rather than to any locale. Exported
// because the HTML rate limiter (server/middleware/99-rate-limit-html.ts)
// skips exactly this set too.
export const RESERVED_PREFIXES = [
  '/_nuxt/',
  '/_i18n/',
  '/api/',
  '/v1/',
  '/__sitemap__',
  '/sitemap',
  '/docs/',
  '/.well-known/',
  '/media/',
];

export const RESERVED_EXACT = new Set(['/__nuxt_error', '/up', '/robots.txt', '/opensearch.xml', '/favicon.ico']);

export function isReservedLocalePath(path: string): boolean {
  if (RESERVED_EXACT.has(path)) return true;
  if (RESERVED_PREFIXES.some((prefix) => path.startsWith(prefix))) return true;
  // Files at root: /github-xxx.png, /logo-xxx.webp, /sitemap-en.xml, etc.
  if (/^\/[^/]+\.[a-zA-Z0-9]+$/.test(path)) return true;
  return false;
}

export function isSupportedLocale(value: string | null | undefined): value is SupportedLocale {
  return value !== null && value !== undefined && (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

export function getLocalePrefix(path: string): SupportedLocale | null {
  for (const locale of SUPPORTED_LOCALES) {
    if (path === `/${locale}` || path.startsWith(`/${locale}/`)) return locale;
  }
  return null;
}

/**
 * Which locale a bare `/` should land on.
 *
 * **Its only input is the `nd-locale-preference` cookie.** That is a deliberate
 * constraint, not an oversight. `/` is the first request of every cold visit and
 * it carries no content, so it is the one hop worth answering at the Cloudflare
 * edge instead of at the origin in Helsinki -- ~10ms of actual work behind ~1.2s
 * of round trip. A Cloudflare Redirect Rule can read a plain cookie
 * (`http.cookie contains "nd-locale-preference=es"`) and nothing else.
 *
 * This used to infer from `Accept-Language`, weighing q-values. Cloudflare cannot
 * do that, so the edge and the origin would have answered the same request
 * differently depending on who happened to reach which -- one decision with two
 * implementations, quietly disagreeing. Removing the inference is what makes the
 * redirect movable.
 *
 * The trade, stated plainly: a Spanish speaker's first visit starts in English
 * and costs them one click on the language selector, which then remembers. That
 * is also what Google asks for -- no automatic language redirection, offer a
 * switcher (the selector and the hreflang alternates are that).
 *
 * **Do not add an input the edge cannot read.** A visitor's stored settings, a
 * session lookup, `CF-IPCountry`, `Accept-Language` -- any of them forces the
 * redirect back to the origin and the latency back with it.
 */
export function resolveRootLocale(cookieValue: string | null | undefined): SupportedLocale {
  return isSupportedLocale(cookieValue) ? cookieValue : 'en';
}
