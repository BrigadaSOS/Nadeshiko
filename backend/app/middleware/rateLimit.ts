import rateLimit from 'express-rate-limit';
import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { config } from '@config/config';
import { logger } from '@config/log';
import { RateLimitExceededError } from '@app/errors';
import { isTrustedInternalCaller } from '@lib/internalProxy';

const WINDOW_MS = config.RATE_LIMIT_WINDOW_MS;
const DEFAULT_MAX = config.RATE_LIMIT_MAX_REQUESTS_PER_IP;
const AUTH_MAX = config.RATE_LIMIT_AUTH_MAX_REQUESTS_PER_IP;

// express-rate-limit's default keyGenerator already keys on `req.ip`, which
// respects Express's `trust proxy` setting (configured to 1 hop in
// application.ts) and normalizes IPv6. We rely on it rather than rolling our
// own key function.
//
// SCOPING: this limiter is for DIRECT browser-to-backend traffic only. Browser
// traffic that reaches us through the frontend Nitro proxy is already rate
// limited per real client IP there (frontend/server/utils/ipRateLimit.ts), and
// at the backend every proxied user collapses onto the proxy's single source
// key — limiting that would throttle them all against one bucket. We therefore
// exempt proxied traffic via `isTrustedInternalCaller`. Crucially, that decision
// is made from an unforgeable shared secret, NOT from `req.ip`/X-Forwarded-For
// (which a client can influence): both direct and proxied traffic reach us
// through kamal-proxy, so neither the source IP nor the TCP peer can be trusted
// to distinguish them.

// Who counts as one of our own — the frontend proxy and SERVICE-key callers —
// lives in @lib/internalProxy, because the traffic classifier gates on exactly
// the same answer and the two must not drift.
const shouldSkip = isTrustedInternalCaller;

// Emit a 429 in the same problem-details envelope as the rest of the API (the
// better-auth API-key limiter already surfaces RateLimitExceededError). Routing
// through next() lets the central error handler attach the requestId/instance
// and record the 4xx error metric.
function buildHandler(scope: 'global' | 'auth', detail: string): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    logger.warn(
      { ip: req.ip, path: req.originalUrl, scope, traffic: req.traffic, 'bot.family': req.botFamily },
      'Rate limit exceeded',
    );

    // express-rate-limit augments the request with timing info for this hit.
    const resetTime = (req as Request & { rateLimit?: { resetTime?: Date } }).rateLimit?.resetTime;
    if (resetTime) {
      const retryAfter = Math.max(1, Math.ceil((resetTime.getTime() - Date.now()) / 1000));
      res.setHeader('Retry-After', String(retryAfter));
    }

    next(new RateLimitExceededError(detail));
  };
}

export const globalRateLimit = rateLimit({
  windowMs: WINDOW_MS,
  limit: DEFAULT_MAX,
  ipv6Subnet: 56,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: shouldSkip,
  handler: buildHandler('global', 'Too many requests from this IP. Please slow down.'),
});

export const authRateLimit = rateLimit({
  windowMs: WINDOW_MS,
  limit: AUTH_MAX,
  ipv6Subnet: 56,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: shouldSkip,
  // Applies to /v1/auth/* (scoped where it is mounted in routes.ts).
  handler: buildHandler('auth', 'Too many auth requests from this IP. Please slow down.'),
});

/**
 * Clears every limiter's hit counters.
 *
 * The limiters are module singletons backed by an in-memory store, so in a
 * single-process test run one file that deliberately exhausts a bucket leaves
 * the next file being rate limited — which surfaces as an unrelated assertion
 * failing on a 429, in a different file, only when the whole suite runs.
 * Intended for test setup; production has no reason to call it.
 */
export function resetRateLimiters(): void {
  // `resetAll` is optional on the store rather than the handler, so it is not on
  // the handler's public type even though the default memory store implements it.
  for (const limiter of [globalRateLimit, authRateLimit]) {
    (limiter as unknown as { resetAll?: () => void }).resetAll?.();
  }
}
