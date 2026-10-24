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
const FEEDBACK_MAX = config.RATE_LIMIT_FEEDBACK_MAX_REQUESTS_PER_IP;

// Group IPv6 by `/56`; a subscriber may rotate addresses within an assigned `/64`.
const IPV6_SUBNET = 56;

/** Use `CF-Connecting-IP` through Cloudflare; `req.ip` is the internal fallback. The header is trusted only behind
 * the origin firewall. */
export function resolveClientIp(req: Request): string {
  const cfConnectingIp = req.get('cf-connecting-ip')?.trim();
  if (cfConnectingIp) return cfConnectingIp;
  return req.ip ?? '';
}

function clientKey(req: Request): string {
  // Apply `ipKeyGenerator` explicitly because a custom key generator otherwise bypasses the configured IPv6 subnet
  // grouping.
  return ipKeyGenerator(resolveClientIp(req), IPV6_SUBNET);
}
// Skip only trusted frontend-proxy traffic using the shared secret, never IP/XFF, because backend IP would merge all
// proxied users.

// Keep the internal-caller predicate shared with traffic classification so the two gates cannot drift.
const shouldSkip = isTrustedInternalCaller;

// Keep metric labels as bounded source classes, not addresses, to prevent unbounded series.
export const RATE_LIMIT_SCOPES = [
  'global',
  'auth',
  'feedback',
  'unsubscribe',
  'sign-in-address',
  'sign-in-global',
] as const;

export type RateLimitScope = (typeof RATE_LIMIT_SCOPES)[number];

const RATE_LIMIT_SOURCES = ['internal', 'external'] as const;

const rateLimitedCount = getMeter().createCounter('http.server.rate_limited', {
  description: 'Requests rejected by the per-IP rate limiter, by caller class',
  unit: '{request}',
});

/** Seed all limiter series at zero and heartbeat them so an unthrottled internal source reads zero, not missing
 * data. */
export function seedRateLimitSeries(): void {
  for (const scope of RATE_LIMIT_SCOPES) {
    for (const source of RATE_LIMIT_SOURCES) {
      rateLimitedCount.add(0, { scope, source });
    }
  }
}

/** Classify private/loopback/link-local traffic as internal; a 429 there signals a proxy configuration failure, not
 * public demand. */
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

// Do not bypass on private IPs: the client can forge `CF-Connecting-IP`; the shared secret is the trusted signal.

// Route limiter failures through the central problem-details handler so request ids and 4xx metrics remain consistent.
function buildHandler(scope: RateLimitScope, detail: string): RequestHandler {
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

    // No address label: the noisy bucket is in the warn line above, and an address per series is unbounded.
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
  skip: shouldSkip,
  // Applies to /v1/auth/* (scoped where it is mounted in routes.ts).
  handler: buildHandler('auth', 'Too many auth requests from this IP. Please slow down.'),
});

/** Direct feedback calls need their own limiter; proxied browser traffic is already keyed per real client at the
 * frontend. */
export const feedbackRateLimit = rateLimit({
  windowMs: WINDOW_MS,
  limit: FEEDBACK_MAX,
  keyGenerator: clientKey,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: shouldSkip,
  handler: buildHandler('feedback', 'Too many feedback submissions from this IP. Please slow down.'),
});

/** Keep unsubscribe in its own bucket so feedback spam cannot block a reader’s opt-out; provider bursts need this
 * budget. */
export const unsubscribeRateLimit = rateLimit({
  windowMs: WINDOW_MS,
  limit: FEEDBACK_MAX,
  keyGenerator: clientKey,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: shouldSkip,
  handler: buildHandler('unsubscribe', 'Too many unsubscribe requests from this IP. Please slow down.'),
});

/** Charge malformed sign-in requests to the IP fallback when no address is available; invalid input must not evade
 * both limits. */
function signInAddressKey(req: Request): string {
  const email = (req.body as { email?: unknown } | undefined)?.email;
  if (typeof email === 'string' && email.trim()) {
    return `email:${email.trim().toLowerCase()}`;
  }

  return `ip:${clientKey(req)}`;
}

/** Do not skip this limiter for frontend traffic: it keys by address, so exempting the proxy would exempt the real
 * sign-in audience. */
export const signInAddressRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  keyGenerator: signInAddressKey,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: buildHandler(
    'sign-in-address',
    'Too many sign-in emails for that address. Please wait before asking for another.',
  ),
});

/** Use a global sign-in-mail ceiling to catch distributed abuse that evades per-address and per-IP limits, accepting
 * that it can refuse everyone. */
export const signInGlobalRateLimit = rateLimit({
  windowMs: 24 * 60 * 60 * 1000,
  limit: 2_000,
  keyGenerator: () => 'sign-in-global',
  standardHeaders: false,
  legacyHeaders: false,
  handler: buildHandler(
    'sign-in-global',
    'Sign-in email is temporarily unavailable. Please try again later, or use a link you already have.',
  ),
});

/** Reset singleton limiter stores between tests; production has no reason to call this helper. */
export function resetRateLimiters(): void {
  // `resetAll` is optional on the store rather than the handler, so it is not on
  // the handler's public type even though the default memory store implements it.
  for (const limiter of [
    globalRateLimit,
    authRateLimit,
    feedbackRateLimit,
    unsubscribeRateLimit,
    signInAddressRateLimit,
    signInGlobalRateLimit,
  ]) {
    (limiter as unknown as { resetAll?: () => void }).resetAll?.();
  }
}
