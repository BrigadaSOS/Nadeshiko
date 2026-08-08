import type { H3Event } from 'h3';
import { createError, setResponseHeader } from 'h3';
import { getClientIp } from './clientIp';

type Bucket = { count: number; windowStart: number };

export interface IpRateLimitOptions {
  windowMs: number;
  max: number;
  route?: string; // disambiguates multiple limiters sharing the same IP key
}

const buckets = new Map<string, Bucket>();

function getOrCreate(key: string, windowMs: number, now: number): Bucket {
  const existing = buckets.get(key);
  if (existing && now - existing.windowStart < windowMs) return existing;
  const fresh: Bucket = { count: 0, windowStart: now };
  buckets.set(key, fresh);
  // Opportunistic cleanup so the Map doesn't grow unbounded.
  if (buckets.size > 10_000) {
    for (const [k, b] of [...buckets]) {
      if (now - b.windowStart >= windowMs * 2) buckets.delete(k);
    }
  }
  return fresh;
}

function clientKey(event: H3Event): string {
  // Deliberately not the leftmost X-Forwarded-For entry, which a client can set
  // for itself -- rotating it used to mint a fresh bucket per request and made
  // this limiter a no-op for anyone who bothered. See getClientIp.
  return getClientIp(event);
}

function safeSetHeader(event: H3Event, name: string, value: string): void {
  setResponseHeader(event, name, value);
}

/**
 * Returns null if the request is allowed, or an H3Error to be thrown
 * upstream (caller wraps in `throw error`). Stamps standard headers on the
 * event's outgoing response.
 */
export async function ipRateLimit(
  event: H3Event,
  opts: IpRateLimitOptions,
): Promise<null | ReturnType<typeof createError>> {
  const now = Date.now();
  const ip = clientKey(event);
  const key = `${opts.route ?? '_'}|${ip}`;
  const bucket = getOrCreate(key, opts.windowMs, now);
  bucket.count += 1;

  const remaining = Math.max(0, opts.max - bucket.count);
  safeSetHeader(event, 'X-RateLimit-Limit', String(opts.max));
  safeSetHeader(event, 'X-RateLimit-Remaining', String(remaining));
  safeSetHeader(event, 'X-RateLimit-Reset', String(Math.ceil((bucket.windowStart + opts.windowMs) / 1000)));

  if (bucket.count > opts.max) {
    const retryAfter = Math.max(1, Math.ceil((bucket.windowStart + opts.windowMs - now) / 1000));
    safeSetHeader(event, 'Retry-After', String(retryAfter));
    const error = createError({
      statusCode: 429,
      statusMessage: 'Too Many Requests',
      data: { reason: 'ip_rate_limit', route: opts.route ?? null },
    });
    // Expose `status` alongside h3's `statusCode` for ergonomic callers/tests.
    (error as { status?: number }).status = 429;
    return error;
  }
  return null;
}

// Test-only -- DO NOT call from prod code
export function _resetForTests(): void {
  buckets.clear();
}
