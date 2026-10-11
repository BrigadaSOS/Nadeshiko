import cors from 'cors';
import type { Request, RequestHandler, Response, NextFunction } from 'express';
import { isPublicApiRoute } from '@lib/publicRoutes';
import { QUOTA_HEADERS } from '@lib/rateLimitReason';

/** Allow cross-origin bearer-key access with `credentials: false`; otherwise an allow-all origin would expose
 * cookie-authenticated routes. */
const corsHandler: RequestHandler = cors({
  origin: '*',
  credentials: false,
  methods: ['GET', 'POST', 'OPTIONS'],
  // Allow only headers a BYOK client needs; arbitrary additions should fail preflight rather than widen the contract.
  allowedHeaders: ['Authorization', 'Content-Type'],
  // Expose rate-limit and quota headers so cross-origin clients can distinguish a monthly cap from a retryable 429.
  exposedHeaders: ['Retry-After', 'RateLimit', 'RateLimit-Policy', ...QUOTA_HEADERS],
  // Cache preflight for a day; otherwise distant clients pay an extra round trip on every search.
  maxAge: 86400,
  optionsSuccessStatus: 204,
});

/** Match the preflight’s requested method, not `OPTIONS`; the allowlist contains the actual route methods. */
function intendedMethod(req: Request): string {
  if (req.method !== 'OPTIONS') return req.method;
  const requested = req.headers['access-control-request-method'];
  return typeof requested === 'string' ? requested : '';
}

/** Normalize a trailing slash only for routes already in the public allowlist; do not copy this leniency to frontend
 * key attachment. */
function normalizePath(path: string): string {
  return path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path;
}

/** Apply CORS only to allowlisted public routes; owner-scoped routes and unsupported methods must still fail in the
 * browser. */
export const corsPolicy: RequestHandler = (req: Request, res: Response, next: NextFunction) => {
  if (!isPublicApiRoute(intendedMethod(req), normalizePath(req.path))) {
    next();
    return;
  }

  corsHandler(req, res, next);
};
