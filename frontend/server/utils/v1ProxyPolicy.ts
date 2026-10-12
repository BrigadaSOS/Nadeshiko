import { getRequestHeader, type H3Event } from 'h3';
import { env } from '~~/config/env';
import { ipRateLimit, type IpRateLimitOptions } from '~~/server/utils/ipRateLimit';
import { presentsBypassSecret, RATE_LIMIT_BYPASS_HEADER } from '~~/server/utils/rateLimitBypass';

const WINDOW_MS_DEFAULT = 60_000;

export const v1AuthLimit: IpRateLimitOptions = {
  route: 'v1.auth',
  windowMs: WINDOW_MS_DEFAULT,

  max: env.NUXT_RATE_LIMIT_V1_AUTH_MAX,
};

export const v1ApiLimit: IpRateLimitOptions = {
  route: 'v1.api',
  windowMs: WINDOW_MS_DEFAULT,

  max: env.NUXT_RATE_LIMIT_V1_API_MAX,
};

export const v1FeedbackLimit: IpRateLimitOptions = {
  route: 'v1.feedback',
  windowMs: WINDOW_MS_DEFAULT,
  // Separate bucket: unauthenticated feedback queues email and needs a stricter abuse budget.
  max: env.NUXT_RATE_LIMIT_V1_FEEDBACK_MAX,
};

// Use the HTML limiter's bypass for E2E requests from one runner. No configured secret means no bypass.
export async function enforceIpRateLimit(event: H3Event, opts: IpRateLimitOptions): Promise<void> {
  if (presentsBypassSecret(getRequestHeader(event, RATE_LIMIT_BYPASS_HEADER), env.NUXT_RATE_LIMIT_BYPASS_SECRET)) {
    return;
  }

  const err = await ipRateLimit(event, opts);
  if (err) throw err;
}
