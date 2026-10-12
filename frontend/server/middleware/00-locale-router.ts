import { LOCALE_PREFERENCE_COOKIE_NAME } from '~/utils/i18n';
import { getLocalePrefix, isReservedLocalePath, isSupportedLocale, resolveRootLocale } from '../utils/localeRouting';

export default defineEventHandler((event) => {
  const url = getRequestURL(event);
  const path = url.pathname;

  if (isReservedLocalePath(path)) return;
  if (getLocalePrefix(path)) return;

  // Unsupported locale-shaped prefixes must 404, not become unprefixed English routes.
  if (/^\/[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})+(?=\/|$)/.test(path)) return;

  const search = url.search;

  // Use the stored locale for bare links, including the exact unprefixed Shirabe OAuth callback; default to English.
  const stored = getCookie(event, LOCALE_PREFERENCE_COOKIE_NAME);
  const target = resolveRootLocale(stored);
  setHeader(event, 'Cache-Control', 'private, no-store');

  // Use 301 for the stable English default, but 302 when a supported preference can change the target.
  // private, no-store prevents browsers from pinning either redirect.
  const status = isSupportedLocale(stored) ? 302 : 301;

  if (path === '/') {
    return sendRedirect(event, `/${target}${search}`, status);
  }

  // Keep deep-link redirects at the origin rather than duplicate reserved-path rules in Cloudflare.
  return sendRedirect(event, `/${target}${path}${search}`, status);
});
