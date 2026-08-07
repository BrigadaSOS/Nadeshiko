import { timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';
import { config } from '@config/config';
import { ApiKeyKind, AuthType } from '@app/models';
import { getCachedApiKey } from '@app/middleware/authCacheStore';

/**
 * Recognising our own callers: the frontend proxy (proven by a shared secret)
 * and our own services (proven by a SERVICE API key).
 *
 * Extracted from rateLimit.ts because a second caller needs the same answer:
 * the traffic classifier believes an inbound `x-nadeshiko-traffic` header only
 * from requests that pass this check. Both uses have the same requirement —
 * the decision cannot come from `req.ip` or X-Forwarded-For, because direct and
 * frontend-proxied traffic both arrive through kamal-proxy and a client can
 * influence those headers.
 */

// Set by the frontend Nitro proxy on every request it forwards
// (frontend/server/utils/internalBackend.ts).
const INTERNAL_PROXY_HEADER = 'x-internal-proxy-auth';

function timingSafeStringEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}

/**
 * True when the request came through our own frontend. When no secret is
 * configured the answer is always false (fail-safe: traffic is limited and
 * classified from its own User-Agent, never silently trusted).
 */
export function isInternalProxyRequest(req: Request): boolean {
  const secret = config.INTERNAL_PROXY_SECRET;
  if (!secret) return false;
  const provided = req.get(INTERNAL_PROXY_HEADER);
  return typeof provided === 'string' && timingSafeStringEqual(provided, secret);
}

// Mirrors the bearer parsing in authentication.ts. Duplicated rather than
// imported so this module does not have to pull in the whole better-auth stack
// just to read a header.
function extractBearerToken(req: Request): string | undefined {
  const authorization = req.headers.authorization;
  if (!authorization?.startsWith('Bearer ')) return undefined;

  const token = authorization.slice('Bearer '.length).trim();
  return token.length > 0 ? token : undefined;
}

/**
 * True when the caller presents a SERVICE API key — our own services (SSR
 * renders, GitHub Actions, the Discord bot) rather than a person's browser.
 */
export function isServiceKeyRequest(req: Request): boolean {
  // The callers mount before the router (see application.ts) so that abusive
  // traffic is rejected without parsing a body, which means the route-level
  // auth middleware has not run yet and `req.auth` is normally unset. Check it
  // anyway for the case where a caller mounts behind auth.
  if (req.auth) {
    return req.auth.type === AuthType.API_KEY && req.auth.apiKey?.kind === ApiKeyKind.SERVICE;
  }

  // Otherwise resolve the key against the synchronous auth cache — the same
  // cache requireApiKeyAuth populates. A key is only ever in there after it has
  // verified against the database, so this cannot be forged by presenting an
  // arbitrary bearer token. A cold or expired entry simply falls through and
  // the request is treated as anonymous (fail-safe: never a silent bypass), and
  // the request that repopulates the cache re-arms it.
  const token = extractBearerToken(req);
  if (!token) return false;

  return getCachedApiKey(token)?.apiKeyKind === ApiKeyKind.SERVICE;
}

/**
 * True when the request came from us rather than from the open internet.
 *
 * What it buys each caller: the rate limiter skips these (they collapse onto a
 * handful of source IPs, so limiting them per IP would throttle unrelated
 * callers against one bucket), and the traffic classifier lets them declare who
 * they are rendering for.
 */
export function isTrustedInternalCaller(req: Request): boolean {
  return isInternalProxyRequest(req) || isServiceKeyRequest(req);
}
