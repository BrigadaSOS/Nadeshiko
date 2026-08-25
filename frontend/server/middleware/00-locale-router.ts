import { LOCALE_PREFERENCE_COOKIE_NAME } from '~/utils/i18n';
import { getLocalePrefix, isReservedLocalePath, isSupportedLocale, resolveRootLocale } from '../utils/localeRouting';

export default defineEventHandler((event) => {
  const url = getRequestURL(event);
  const path = url.pathname;

  if (isReservedLocalePath(path)) return;
  if (getLocalePrefix(path)) return;

  const search = url.search;

  // Cookie in, locale out -- see `resolveRootLocale` for why this reads nothing
  // else, and what breaks if that changes. The same rule for `/` and for an
  // unprefixed deep link: a reader who chose Spanish and follows a bare link
  // lands in Spanish, and a visitor with no preference (every crawler) lands in
  // English, as before. Deep links used to go to `/en` unconditionally, which
  // was wrong for the one deep link that CANNOT carry a prefix -- the Shirabe
  // OAuth callback is registered over there as an exact address, so the locale
  // is decided here or not at all.
  const stored = getCookie(event, LOCALE_PREFERENCE_COOKIE_NAME);
  const target = resolveRootLocale(stored);
  setHeader(event, 'Cache-Control', 'private, no-store');

  // PERMANENT ONLY WHEN THE READER HAS EXPRESSED NO PREFERENCE, which is every
  // crawler and every first visit. `resolveRootLocale` returns `'en'` for a
  // missing or unrecognised cookie unconditionally, so in that branch the
  // mapping really is permanent -- `/privacy` is `/en/privacy` and cannot become
  // anything else -- and 301 is the honest status for it.
  //
  // WHY IT MATTERS. A 302 tells a search engine to keep indexing the address it
  // asked for, so every unprefixed URL stayed in the index as a second copy of
  // its `/en` twin instead of consolidating onto it. Over the 3 months to
  // 2026-08-25 that was 166 URLs holding 8,114 impressions -- 18.7% of the
  // site's total -- split off from the pages that were supposed to receive them,
  // `/` (16,300 impressions) and `/en` (1,447) being the same page twice.
  //
  // WHEN A COOKIE IS PRESENT this stays a 302, which is the case the original
  // note was about: that redirect genuinely varies per reader, and a browser
  // that cached it permanently would pin a reader to the locale they happened to
  // hold on their first visit. Crawlers never reach this branch -- they send no
  // cookies -- so nothing is lost by leaving it temporary.
  //
  // The `Cache-Control: private, no-store` above covers the residual worry about
  // browsers caching 301s: it is set on this response before either branch, and
  // a response a browser must not store is one it cannot replay.
  const status = isSupportedLocale(stored) ? 302 : 301;

  if (path === '/') {
    return sendRedirect(event, `/${target}${search}`, status);
  }

  // Unlike `/`, these stay at the origin. Answering them at the edge would mean
  // restating `isReservedLocalePath` as a Cloudflare expression -- nine
  // prefixes, four exact paths and a file-extension regex, in a second home that
  // drifts silently. `/` is where the first-visit cost actually is.
  return sendRedirect(event, `/${target}${path}${search}`, status);
});
