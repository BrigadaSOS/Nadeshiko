import rateLimit from 'express-rate-limit';
import type { Request, RequestHandler } from 'express';
import { config } from '@config/config';
import { logger } from '@config/log';
import { ApiKeyKind, AuthType } from '@app/models';

const WINDOW_MS = config.RATE_LIMIT_WINDOW_MS;
const DEFAULT_MAX = config.RATE_LIMIT_MAX_REQUESTS_PER_IP;
const AUTH_MAX = config.RATE_LIMIT_AUTH_MAX_REQUESTS_PER_IP;

// express-rate-limit's default keyGenerator already keys on `req.ip`, which
// respects Express's `trust proxy` setting (configured to 1 hop in
// application.ts) and normalizes IPv6. We rely on it rather than rolling our
// own key function.
//
// Note: most authenticated/session traffic reaches the backend via the
// frontend Nitro proxy, which strips the original client IP. For that path
// the effective client IP is the frontend container (172.18.0.9). The
// **real per-IP defense for browser-facing traffic lives in the frontend
// Nitro rate limiter** (frontend/server/utils/ipRateLimit.ts). This
// middleware is defense in depth — it catches direct browser-to-backend
// traffic and any path the frontend proxy doesn't cover.

function isServiceKeyRequest(req: Request): boolean {
  // The auth middleware sets req.auth with type API_KEY and the resolved
  // apiKey. SERVICE keys are server-to-server (our own services, GitHub
  // Actions, etc.) and all share the frontend container's IP at the backend,
  // so they must not be rate-limited per source IP.
  return req.auth?.type === AuthType.API_KEY && req.auth.apiKey?.kind === ApiKeyKind.SERVICE;
}

export const globalRateLimit: RequestHandler = rateLimit({
  windowMs: WINDOW_MS,
  limit: DEFAULT_MAX,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: (req) => isServiceKeyRequest(req),
  handler: (req, res) => {
    logger.warn({ ip: req.ip, path: req.originalUrl }, 'Rate limit exceeded (global)');
    res.status(429).json({
      error: 'rate_limited',
      message: 'Too many requests from this IP. Please slow down.',
    });
  },
});

export const authRateLimit: RequestHandler = rateLimit({
  windowMs: WINDOW_MS,
  limit: AUTH_MAX,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: (req) => isServiceKeyRequest(req),
  // Applies to /v1/auth/* (scoped where it is mounted in routes.ts).
  handler: (req, res) => {
    logger.warn({ ip: req.ip, path: req.originalUrl }, 'Rate limit exceeded (auth)');
    res.status(429).json({
      error: 'rate_limited',
      message: 'Too many auth requests from this IP. Please slow down.',
    });
  },
});
