import { LOCALE_PREFERENCE_COOKIE_NAME } from '~/utils/i18n';
import { getLocalePrefix, isReservedLocalePath, resolveRootLocale } from '../utils/localeRouting';

export default defineEventHandler((event) => {
  const url = getRequestURL(event);
  const path = url.pathname;

  if (isReservedLocalePath(path)) return;
  if (getLocalePrefix(path)) return;

  const search = url.search;

  if (path === '/') {
    // Cookie in, locale out -- see `resolveRootLocale` for why this reads nothing
    // else, and what breaks if that changes.
    const target = resolveRootLocale(getCookie(event, LOCALE_PREFERENCE_COOKIE_NAME));
    setHeader(event, 'Cache-Control', 'private, no-store');
    return sendRedirect(event, `/${target}${search}`, 302);
  }

  // Keep unprefixed deep links flexible until locale routing is fully settled.
  // Browsers can cache 301s aggressively even without a CDN in front.
  //
  // Unlike `/` above, these stay at the origin. Answering them at the edge would
  // mean restating `isReservedLocalePath` as a Cloudflare expression -- nine
  // prefixes, four exact paths and a file-extension regex, in a second home that
  // drifts silently. `/` is where the first-visit cost actually is.
  setHeader(event, 'Cache-Control', 'private, no-store');
  return sendRedirect(event, `/en${path}${search}`, 302);
});
