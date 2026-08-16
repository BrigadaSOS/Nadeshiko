import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { config } from '@config/config';
import { logger } from '@config/log';
import { RateLimitExceededError } from '@app/errors';
import { isTrustedInternalCaller } from '@lib/internalProxy';
import { getMeter } from '@config/telemetry';

const WINDOW_MS = config.RATE_LIMIT_WINDOW_MS;
const DEFAULT_MAX = config.RATE_LIMIT_MAX_REQUESTS_PER_IP;
const AUTH_MAX = config.RATE_LIMIT_AUTH_MAX_REQUESTS_PER_IP;

// IPv6 is grouped by /56 rather than by address: a single subscriber is
// routinely handed a whole /64, so keying on the full address lets one client
// rotate through addresses it already owns.
const IPV6_SUBNET = 56;

/**
 * Who to count this request against.
 *
 * NOT `req.ip`, which is what this used to use and which is wrong here. Express
 * resolves `req.ip` from `trust proxy` (1 hop, set in application.ts) by
 * walking X-Forwarded-For from the right, and there are *two* proxies in front
 * of us: Cloudflare, then kamal-proxy. The header that reaches this process
 * therefore reads `<visitor>, <cloudflare edge>` and `req.ip` lands on the
 * Cloudflare edge address, not the visitor.
 *
 * That made the limit meaningless in both directions, measured against
 * production: twelve requests from one machine landed in four different buckets
 * (each answering `remaining=299`) because consecutive requests exit different
 * edge servers -- so an abusive client is never counted twice -- while
 * unrelated visitors sharing an edge were counted against each other.
 *
 * `CF-Connecting-IP` is a single unambiguous value that Cloudflare sets and
 * overwrites on every proxied request. Counting the XFF hops instead would work
 * today and is what the previous comment assumed; it is not used because the
 * chain length is not actually constant -- kamal-proxy's own logs show both one
 * and two entries for the same visitor -- so a fixed hop count would silently
 * pick the wrong element for some requests.
 *
 * The fallback keeps internal callers working: container-to-container traffic
 * carries no Cloudflare header, and `req.ip` is correct for it.
 *
 * Trust boundary: this is only as good as the guarantee that traffic arrives
 * through Cloudflare, which is a firewall question. See the Cloudflare section
 * of DEPLOYMENT.md. Until the origin is locked, someone who has learned the
 * origin address can set this header themselves -- exactly as they could
 * already forge X-Forwarded-For, so it is not a regression.
 */
export function resolveClientIp(req: Request): string {
  const cfConnectingIp = req.get('cf-connecting-ip')?.trim();
  if (cfConnectingIp) return cfConnectingIp;
  return req.ip ?? '';
}

function clientKey(req: Request): string {
  // ipKeyGenerator applies the IPv6 grouping that the default key generator
  // would have applied; a custom keyGenerator opts out of the `ipv6Subnet`
  // option, so it has to be done here or IPv6 silently keys per address.
  return ipKeyGenerator(resolveClientIp(req), IPV6_SUBNET);
}
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

// Four series at most (two scopes x two sources), which is why `source` is a
// class and not the address itself: the address is unbounded, and the question
// this answers needs only the class.
const rateLimitedCount = getMeter().createCounter('http.server.rate_limited', {
  description: 'Requests rejected by the per-IP rate limiter, by caller class',
  unit: '{request}',
});

/**
 * Private-range, loopback and link-local addresses -- the container network and
 * the host, never the public internet.
 *
 * A 429 against one of these means we are throttling ourselves. It is not a
 * capacity signal, it is a configuration bug: some internal caller is failing
 * the `isTrustedInternalCaller` check and competing with every other internal
 * caller for one bucket. That is invisible in every other signal (the requests
 * simply fail and get retried) until it becomes an outage under load, which is
 * exactly how it was found. The alert built on this counter is
 * NadeshikoBackendProdRateLimitingItself, in
 * brigadasos-infra/machines/monitoring/victoria/config/vmalert-rules/.
 *
 * Matched by class rather than by a specific address on purpose: container IPs
 * are assigned by Docker and are reshuffled by a host reboot, so a rule naming
 * one of them silently stops matching the thing it was written for.
 */
export function isPrivateAddress(ip: string | undefined): boolean {
  if (!ip) return false;
  // Express reports IPv4-mapped IPv6 as `::ffff:172.18.0.9`.
  const bare = ip.startsWith('::ffff:') ? ip.slice('::ffff:'.length) : ip;

  if (bare === '::1' || bare.startsWith('127.')) return true;
  if (bare.startsWith('10.') || bare.startsWith('192.168.')) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(bare)) return true;
  // IPv6 unique-local (fc00::/7) and link-local (fe80::/10).
  if (/^f[cd]/i.test(bare) || /^fe[89ab]/i.test(bare)) return true;

  return false;
}

/**
 * Defence-in-depth skip for traffic from our own frontend Nitro container.
 *
 * The frontend already rate-limits `/v1/auth/*` per real visitor IP at the
 * Nitro layer (frontend/server/utils/ipRateLimit.ts, configurable via
 * NUXT_RATE_LIMIT_V1_AUTH_MAX), so backend-side auth-IP limiting is a
 * redundant second gate that collides with itself: every SSR render of a
 * logged-in reader asks the backend's `/v1/auth/get-session` from the same
 * source IP, and a sustained render burst hits the bucket long before any
 * real visitor would.
 *
 * The primary bypass is the `x-internal-proxy-auth` shared secret
 * (isInternalProxyRequest in @lib/internalProxy). This clause is a
 * belt-and-braces fallback for the case where the secret is missing,
 * rotated, or the request bypassed the helper that stamps the header. It
 * matches by IP class -- any RFC1918 / link-local / loopback address -- which
 * is exactly the same set the private-range comment above warns about as
 * "us, not the internet". If a request from one of those reaches
 * `authRateLimit`, the request originated on this host or its docker
 * network, which means it is ours to throttle ourselves into shape for.
 *
 * Restricted to `authRateLimit`: the global limiter stays in place even for
 * internal callers because they share the bucket with everyone else and an
 * internal caller that has gone wrong (a tight loop, a runaway cron) is
 * exactly what the global cap should still catch.
 */
function authRateLimitSkip(req: Request): boolean {
  if (shouldSkip(req)) return true;
  return isPrivateAddress(resolveClientIp(req));
}

// Emit a 429 in the same problem-details envelope as the rest of the API (the
// better-auth API-key limiter already surfaces RateLimitExceededError). Routing
// through next() lets the central error handler attach the requestId/instance
// and record the 4xx error metric.
function buildHandler(scope: 'global' | 'auth', detail: string): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    // The same address the bucket was keyed on, not `req.ip` -- otherwise the
    // log and the alert describe a different client than the one being counted.
    const clientIp = resolveClientIp(req);
    const source = isPrivateAddress(clientIp) ? 'internal' : 'external';

    logger.warn(
      {
        ip: clientIp,
        path: req.originalUrl,
        scope,
        source,
        traffic: req.traffic,
        'bot.family': req.botFamily,
      },
      'Rate limit exceeded',
    );

    rateLimitedCount.add(1, { scope, source });

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
  keyGenerator: clientKey,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: shouldSkip,
  handler: buildHandler('global', 'Too many requests from this IP. Please slow down.'),
});

export const authRateLimit = rateLimit({
  windowMs: WINDOW_MS,
  limit: AUTH_MAX,
  keyGenerator: clientKey,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: authRateLimitSkip,
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
