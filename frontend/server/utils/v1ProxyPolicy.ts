import type { H3Event } from 'h3';
import { env } from '~~/config/env';
import { ipRateLimit, type IpRateLimitOptions } from '~~/server/utils/ipRateLimit';

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
 */
export async function enforceIpRateLimit(event: H3Event, opts: IpRateLimitOptions): Promise<void> {
  const err = await ipRateLimit(event, opts);
  if (err) throw err;
}
