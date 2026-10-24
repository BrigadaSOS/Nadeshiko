import { getRequestHeader, type H3Event } from 'h3';
import { env } from '~~/config/env';
import { ipRateLimit, type IpRateLimitOptions } from '~~/server/utils/ipRateLimit';
import { presentsBypassSecret, RATE_LIMIT_BYPASS_HEADER } from '~~/server/utils/rateLimitBypass';
import { normalizeExpressPath } from '~~/server/utils/serverOnlyProxyRoute';

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

export const shirabeLookupLimit: IpRateLimitOptions = {
  route: 'api.shirabe',
  windowMs: WINDOW_MS_DEFAULT,
  // Every distinct hint combination is a fresh upstream call, so the server cache alone cannot absorb a flood.
  max: env.NUXT_RATE_LIMIT_SHIRABE_MAX,
};

// Nitro routes case-sensitively but Express does not, so `/v1/Feedback` reaches the feedback handler through a
// looser catch-all. Choose the bucket from the path Express will route (the forwarded, dot-resolved pathname).
export function v1LimitFor(method: string, pathname: string): IpRateLimitOptions {
  const path = normalizeExpressPath(pathname);
  if (path === '/v1/auth' || path.startsWith('/v1/auth/')) return v1AuthLimit;
  if (method.toUpperCase() === 'POST' && path === '/v1/feedback') return v1FeedbackLimit;
  return v1ApiLimit;
}

// URL parsing resolves `..`, `%2e%2e` and `.%2E` before forwarding, so the route Nitro picked from the raw path
// is not the one the backend runs. No API path legitimately contains a dot segment.
export function hasDotSegment(rawPath: string): boolean {
  const pathname = rawPath.split('?', 1)[0] ?? '';
  return pathname.split('/').some((segment) => {
    let decoded: string;
    try {
      decoded = decodeURIComponent(segment);
    } catch {
      return false;
    }
    return decoded.split(/[/\\]/).some((part) => part === '.' || part === '..');
  });
}

// Use the HTML limiter's bypass for E2E requests from one runner. No configured secret means no bypass.
export async function enforceIpRateLimit(event: H3Event, opts: IpRateLimitOptions): Promise<void> {
  if (presentsBypassSecret(getRequestHeader(event, RATE_LIMIT_BYPASS_HEADER), env.NUXT_RATE_LIMIT_BYPASS_SECRET)) {
    return;
  }

  const err = await ipRateLimit(event, opts);
  if (err) throw err;
}
