import { env } from '~~/config/env';
import { ipRateLimit, type IpRateLimitOptions } from '~~/server/utils/ipRateLimit';
import { RESERVED_EXACT, RESERVED_PREFIXES } from '~~/server/utils/localeRouting';

// Throttle HTML renders per IP. The paths to leave alone -- the static redirects
// (00-locale, search-redirect), the API proxy (v1/*), the health endpoint and
// Nuxt's internal assets -- are the same set the locale router treats as
// reserved, so it is kept in one place there.

const HTML_LIMIT: IpRateLimitOptions = {
  route: 'html',
  windowMs: 60_000,
  // ~1 req/s sustained per IP. Real users don't hit this. Bots do.
  max: env.NUXT_RATE_LIMIT_HTML_MAX,
};

export default defineEventHandler(async (event) => {
  const url = getRequestURL(event);
  const path = url.pathname;

  if (RESERVED_EXACT.has(path)) return;
  if (RESERVED_PREFIXES.some((p) => path.startsWith(p))) return;

  const err = await ipRateLimit(event, HTML_LIMIT);
  if (err) throw err;
});
