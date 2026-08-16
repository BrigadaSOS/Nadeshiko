import cors from 'cors';
import type { Request, RequestHandler, Response, NextFunction } from 'express';
import { isPublicApiRoute } from '@lib/publicRoutes';
import { QUOTA_HEADERS } from '@lib/rateLimitReason';

/**
 * Cross-origin access to the public corpus, for third-party clients that call
 * this API straight from a browser with the user's own API key.
 *
 * WHY `*` AND NOT AN ORIGIN ALLOWLIST. The clients this exists for are
 * browser-side Japanese-learning tools that users also run locally: a hosted
 * copy at some partner's domain, plus `http://localhost:3000`, `:5173`,
 * `127.0.0.1`, a LAN address, a fork on someone else's host, and `file://`
 * (which sends `Origin: null`). That set is unbounded and unknowable, so an
 * allowlist would be a redeploy per user and would still be wrong for most of
 * them. It also buys nothing: CORS constrains BROWSERS, and anyone who wanted
 * this data outside a browser can already curl it with the same key. The
 * allowlist below is on ROUTES, which is where the real question lives.
 *
 * `credentials` MUST stay false, and that is the load-bearing line here. With
 * `Access-Control-Allow-Credentials: true` an allow-all origin becomes a hole
 * rather than a convenience: every cookie-authenticated route -- `/v1/auth/*`
 * and everything owner-scoped -- would become readable by script on any page
 * the user visits while signed in. Authentication for these callers is a
 * `Bearer` header they attach deliberately, which is exactly the case that does
 * not need credentials mode.
 */
const corsHandler: RequestHandler = cors({
  origin: '*',
  credentials: false,
  methods: ['GET', 'POST', 'OPTIONS'],
  // Exactly what a BYOK client needs and nothing more. A client that invents a
  // header (`X-App-Version` is the usual one) fails preflight and reads as "the
  // API is broken" -- worth saying in the integration docs rather than widening.
  allowedHeaders: ['Authorization', 'Content-Type'],
  // Without this the rate-limit signals are invisible to script: the browser
  // hides every response header from cross-origin JS bar a short safelist.
  // `RateLimit`/`RateLimit-Policy` are the draft-7 headers `globalRateLimit`
  // already emits on EVERY response, so a client that reads them can slow down
  // before it is throttled rather than after.
  // `X-RateLimit-Reason` and the `X-Monthly-Quota-*` trio come from
  // @lib/rateLimitReason: which limit rejected the call, and how much of the
  // month is left. Without them a BYOK client sees an undifferentiated 429 and
  // retries a monthly cap as if waiting would clear it.
  exposedHeaders: ['Retry-After', 'RateLimit', 'RateLimit-Policy', ...QUOTA_HEADERS],
  // A day. Preflight is a full round trip to the origin that carries no data,
  // and these callers are often far from it; at this TTL a client pays it once
  // per endpoint per day instead of on every search.
  maxAge: 86400,
  optionsSuccessStatus: 204,
});

/**
 * The method this request is really asking about.
 *
 * A preflight arrives as `OPTIONS` and names the method it is checking in
 * `Access-Control-Request-Method`. Matching the allowlist against `OPTIONS`
 * itself would never hit -- the list holds `POST /v1/search`, not
 * `OPTIONS /v1/search` -- so every preflight would be refused and the whole
 * mechanism would silently do nothing.
 */
function intendedMethod(req: Request): string {
  if (req.method !== 'OPTIONS') return req.method;
  const requested = req.headers['access-control-request-method'];
  return typeof requested === 'string' ? requested : '';
}

/**
 * The path as the allowlist spells it.
 *
 * Express routes `/v1/search/` and `/v1/search` to the same handler (strict
 * routing is off), but the generated allowlist holds only the unslashed form.
 * Without this, a client that trailing-slashed its base URL would get a working
 * response from curl and an opaque CORS failure in the browser -- the single
 * hardest thing for a third-party integrator to diagnose, since nothing on
 * either side reports a reason.
 *
 * Leniency here cannot widen access: it only lets a route that IS public be
 * recognised as public. The frontend's copy of the matcher is deliberately left
 * alone, because there the same question decides whether to attach the MASTER
 * key, and that is not a place to be lenient.
 */
function normalizePath(path: string): string {
  return path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path;
}

/**
 * Applies CORS to the public corpus routes only.
 *
 * Non-allowlisted routes fall through untouched: no `Access-Control-*` headers,
 * and a preflight for one reaches the 404 handler rather than being answered.
 * Both leave the browser refusing the request, which is the intent -- an
 * owner-scoped route is not made cross-origin readable by accident, and a
 * preflight naming a method the route does not allow (`DELETE /v1/search`)
 * fails for the same reason.
 */
export const corsPolicy: RequestHandler = (req: Request, res: Response, next: NextFunction) => {
  if (!isPublicApiRoute(intendedMethod(req), normalizePath(req.path))) {
    next();
    return;
  }

  corsHandler(req, res, next);
};
