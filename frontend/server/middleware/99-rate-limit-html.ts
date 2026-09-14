import { env } from '~~/config/env';
import { ipRateLimit, type IpRateLimitOptions } from '~~/server/utils/ipRateLimit';
import { RESERVED_EXACT, RESERVED_PREFIXES } from '~~/server/utils/localeRouting';
import { presentsBypassSecret, RATE_LIMIT_BYPASS_HEADER } from '~~/server/utils/rateLimitBypass';
import { getClientIp } from '~~/server/utils/clientIp';
import { isVerifiedCrawler } from '~~/server/utils/verifiedCrawler';

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
  // Before the limiter, not inside it: a bypassed request should not consume a
  // slot in the bucket either, or a CI run would still exhaust the budget for
  // whatever real visitor shares its address.
  if (presentsBypassSecret(getRequestHeader(event, RATE_LIMIT_BYPASS_HEADER), env.NUXT_RATE_LIMIT_BYPASS_SECRET)) {
    return;
  }
  // Verified crawlers may crawl sentence permalinks without consuming the
  // limiter: those pages are the corpus' long-tail index and are edge-cached.
  // Search renders are different. Each novel query is an SSR render that fans
  // out to the backend and Elasticsearch, and verified crawlers can still send
  // thousands of those requests from a small set of addresses. Letting them
  // bypass this limit was the root cause of the current incident: Cloudflare's
  // verified-bot exemption correctly let the requests through, while this
  // exemption admitted every expensive search render to the origin.
  //
  // Proof remains forward-confirmed reverse DNS, never the User-Agent -- see
  // verifiedCrawler.ts.
  const isSentencePermalink = /^\/(?:[a-z]{2}(?:-[A-Z]{2})?\/)?sentence\//.test(path);
  if (
    isSentencePermalink &&
    isVerifiedCrawler(getClientIp(event), getRequestHeader(event, 'user-agent'))
  ) {
    return;
  }

  const err = await ipRateLimit(event, HTML_LIMIT);
  if (err) throw err;
});
