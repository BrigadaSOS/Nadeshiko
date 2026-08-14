import { getRequestHeader, type H3Event } from 'h3';
import { env } from '~~/config/env';
import { ipRateLimit, type IpRateLimitOptions } from '~~/server/utils/ipRateLimit';
import { presentsBypassSecret, RATE_LIMIT_BYPASS_HEADER } from '~~/server/utils/rateLimitBypass';

const WINDOW_MS_DEFAULT = 60_000;

export const v1AuthLimit: IpRateLimitOptions = {
  route: 'v1.auth',
  windowMs: WINDOW_MS_DEFAULT,
  // Tight enough to catch the bot, loose enough that a real user clicking
  // around rapidly is never blocked (an SSR render = 1 call; a page click
  // chain might burst 5-10 in a second).
  max: env.NUXT_RATE_LIMIT_V1_AUTH_MAX,
};

export const v1ApiLimit: IpRateLimitOptions = {
  route: 'v1.api',
  windowMs: WINDOW_MS_DEFAULT,
  // General /v1/* proxy -- public search, media, etc. The bot hits this too.
  max: env.NUXT_RATE_LIMIT_V1_API_MAX,
};

/**
 * Throw 429 if the request exceeds the per-IP rate limit. Must be called
 * inside an `await`-able event handler.
 *
 * Honours the same bypass the HTML limiter does, and for the same reason: the
 * end-to-end suite runs from ONE address and does not fit inside a per-IP
 * budget. The HTML limiter got a door and this one did not, which left the
 * suite throttled anyway -- a run spends far more requests on `/v1` than on
 * renders. Running out never failed honestly: `/v1/search/stats` would 429
 * while the results call beside it succeeded, so the page rendered its results
 * with no category tabs and no media sidebar, and whichever test happened to
 * look for one reported a broken feature.
 *
 * NO SECRET, NO BYPASS -- `presentsBypassSecret` returns false on an empty
 * expected value, which is the state production is in.
 */
export async function enforceIpRateLimit(event: H3Event, opts: IpRateLimitOptions): Promise<void> {
  if (presentsBypassSecret(getRequestHeader(event, RATE_LIMIT_BYPASS_HEADER), env.NUXT_RATE_LIMIT_BYPASS_SECRET)) {
    return;
  }

  const err = await ipRateLimit(event, opts);
  if (err) throw err;
}
