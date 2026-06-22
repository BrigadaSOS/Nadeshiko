import { timingSafeEqual } from 'node:crypto';
import rateLimit from 'express-rate-limit';
import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { config } from '@config/config';
import { logger } from '@config/log';
import { RateLimitExceededError } from '@app/errors';
import { ApiKeyKind, AuthType } from '@app/models';

const WINDOW_MS = config.RATE_LIMIT_WINDOW_MS;
const DEFAULT_MAX = config.RATE_LIMIT_MAX_REQUESTS_PER_IP;
const AUTH_MAX = config.RATE_LIMIT_AUTH_MAX_REQUESTS_PER_IP;

// Header carrying the shared internal-proxy secret. Set by the frontend Nitro
// proxy on every request it forwards (frontend/server/utils/backendProxy.ts).
const INTERNAL_PROXY_HEADER = 'x-internal-proxy-auth';
const INTERNAL_PROXY_SECRET = config.INTERNAL_PROXY_SECRET;

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
// exempt proxied traffic via `isInternalProxyRequest`. Crucially, that decision
// is made from an unforgeable shared secret, NOT from `req.ip`/X-Forwarded-For
// (which a client can influence): both direct and proxied traffic reach us
// through kamal-proxy, so neither the source IP nor the TCP peer can be trusted
// to distinguish them.

function isServiceKeyRequest(req: Request): boolean {
  // The auth middleware sets req.auth with type API_KEY and the resolved
  // apiKey. SERVICE keys are server-to-server (our own services, GitHub
  // Actions, etc.) and all share the frontend container's IP at the backend,
  // so they must not be rate-limited per source IP.
  return req.auth?.type === AuthType.API_KEY && req.auth.apiKey?.kind === ApiKeyKind.SERVICE;
}

// True when the request came through our own frontend Nitro proxy, proven by a
// shared secret only that proxy holds. Unlike an IP/header-derived heuristic,
// this cannot be forged by a direct client (who does not know the secret). When
// no secret is configured the exemption is disabled (fail-safe: traffic is
// limited, never silently bypassed).
function isInternalProxyRequest(req: Request): boolean {
  if (!INTERNAL_PROXY_SECRET) return false;
  const provided = req.get(INTERNAL_PROXY_HEADER);
  return typeof provided === 'string' && timingSafeStringEqual(provided, INTERNAL_PROXY_SECRET);
}

function timingSafeStringEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}

function shouldSkip(req: Request): boolean {
  return isServiceKeyRequest(req) || isInternalProxyRequest(req);
}

// Emit a 429 in the same problem-details envelope as the rest of the API (the
// better-auth API-key limiter already surfaces RateLimitExceededError). Routing
// through next() lets the central error handler attach the requestId/instance
// and record the 4xx error metric.
function buildHandler(scope: 'global' | 'auth', detail: string): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    logger.warn({ ip: req.ip, path: req.originalUrl, scope }, 'Rate limit exceeded');

    // express-rate-limit augments the request with timing info for this hit.
    const resetTime = (req as Request & { rateLimit?: { resetTime?: Date } }).rateLimit?.resetTime;
    if (resetTime) {
      const retryAfter = Math.max(1, Math.ceil((resetTime.getTime() - Date.now()) / 1000));
      res.setHeader('Retry-After', String(retryAfter));
    }

    next(new RateLimitExceededError(detail));
  };
}

export const globalRateLimit: RequestHandler = rateLimit({
  windowMs: WINDOW_MS,
  limit: DEFAULT_MAX,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: shouldSkip,
  handler: buildHandler('global', 'Too many requests from this IP. Please slow down.'),
});

export const authRateLimit: RequestHandler = rateLimit({
  windowMs: WINDOW_MS,
  limit: AUTH_MAX,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: shouldSkip,
  // Applies to /v1/auth/* (scoped where it is mounted in routes.ts).
  handler: buildHandler('auth', 'Too many auth requests from this IP. Please slow down.'),
});
