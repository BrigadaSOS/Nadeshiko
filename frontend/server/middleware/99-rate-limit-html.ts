import { env } from '~~/config/env';
import { ipRateLimit, type IpRateLimitOptions } from '~~/server/utils/ipRateLimit';
import { getLocalePrefix, RESERVED_EXACT, RESERVED_PREFIXES } from '~~/server/utils/localeRouting';
import { presentsBypassSecret, RATE_LIMIT_BYPASS_HEADER } from '~~/server/utils/rateLimitBypass';
import { getClientIp } from '~~/server/utils/clientIp';
import { isVerifiedCrawler } from '~~/server/utils/verifiedCrawler';

// Share reserved paths with locale routing; redirects, APIs and assets do not consume render buckets.

const HTML_LIMIT: IpRateLimitOptions = {
  route: 'html',
  windowMs: 60_000,

  max: env.NUXT_RATE_LIMIT_HTML_MAX,
};

export default defineEventHandler(async (event) => {
  const url = getRequestURL(event);
  const path = url.pathname;

  if (RESERVED_EXACT.has(path)) return;
  if (RESERVED_PREFIXES.some((p) => path.startsWith(p))) return;
  // Bypassed requests must not consume the shared per-IP bucket.
  if (presentsBypassSecret(getRequestHeader(event, RATE_LIMIT_BYPASS_HEADER), env.NUXT_RATE_LIMIT_BYPASS_SECRET)) {
    return;
  }
  // Only verified sentence crawls bypass limits. Novel searches still fan out to backend/Elasticsearch and can
  // overload SSR even from legitimate crawlers. Proof is forward-confirmed reverse DNS, never User-Agent.
  const locale = getLocalePrefix(path);
  const pathWithoutLocale = locale ? path.slice(locale.length + 1) : path;
  const isSentencePermalink = pathWithoutLocale.startsWith('/sentence/');
  if (isSentencePermalink && isVerifiedCrawler(getClientIp(event), getRequestHeader(event, 'user-agent'))) {
    return;
  }

  const err = await ipRateLimit(event, HTML_LIMIT);
  if (err) throw err;
});
