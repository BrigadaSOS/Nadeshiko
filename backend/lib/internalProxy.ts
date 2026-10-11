import { timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';
import { config } from '@config/config';
import { ApiKeyKind, AuthType } from '@app/models';
import { getCachedApiKey } from '@app/middleware/authCacheStore';

/** Recognize internal callers only by the shared proxy secret or a verified SERVICE key; never use IP/forwarded
 * headers, which direct and proxied clients can influence. */

// Set by the frontend Nitro proxy on every request it forwards
// (frontend/server/utils/internalBackend.ts).
const INTERNAL_PROXY_HEADER = 'x-internal-proxy-auth';

function timingSafeStringEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}

/** Missing proxy secret means false: fail safe by limiting/classifying traffic rather than trusting it. */
export function isInternalProxyRequest(req: Request): boolean {
  const secret = config.INTERNAL_PROXY_SECRET;
  if (!secret) return false;
  const provided = req.get(INTERNAL_PROXY_HEADER);
  return typeof provided === 'string' && timingSafeStringEqual(provided, secret);
}

// Duplicate bearer parsing to avoid importing the full better-auth stack just to read a header.
function extractBearerToken(req: Request): string | undefined {
  const authorization = req.headers.authorization;
  if (!authorization?.startsWith('Bearer ')) return undefined;

  const token = authorization.slice('Bearer '.length).trim();
  return token.length > 0 ? token : undefined;
}

/** A SERVICE key identifies our own services, not a person’s browser. */
export function isServiceKeyRequest(req: Request): boolean {
  // The callers mount before the router (see application.ts) so that abusive
  // traffic is rejected without parsing a body, which means the route-level
  // auth middleware has not run yet and `req.auth` is normally unset. Check it
  // anyway for the case where a caller mounts behind auth.
  if (req.auth) {
    return req.auth.type === AuthType.API_KEY && req.auth.apiKey?.kind === ApiKeyKind.SERVICE;
  }

  // Use only the verified synchronous API-key cache; cold/expired/missing entries fail closed and the request that
  // refreshes the cache re-arms internal status.
  const token = extractBearerToken(req);
  if (!token) return false;

  return getCachedApiKey(token)?.apiKeyKind === ApiKeyKind.SERVICE;
}

/** Internal callers bypass per-IP limits because they share a few proxy addresses, and may declare their rendering
 * identity for traffic classification. */
export function isTrustedInternalCaller(req: Request): boolean {
  return isInternalProxyRequest(req) || isServiceKeyRequest(req);
}
