import type { H3Event } from 'h3';

type RateLimitBucket = {
  count: number;
  resetAt: number;
};

const buckets = new Map<string, RateLimitBucket>();
let lastCleanupAt = 0;
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;

function parsePositiveInteger(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function getClientIp(event: H3Event): string {
  const cfConnectingIp = getHeader(event, 'cf-connecting-ip');
  if (cfConnectingIp) {
    return cfConnectingIp;
  }

  const xForwardedFor = getHeader(event, 'x-forwarded-for');
  if (xForwardedFor) {
    const first = xForwardedFor.split(',')[0]?.trim();
    if (first) {
      return first;
    }
  }

  const xRealIp = getHeader(event, 'x-real-ip');
  if (xRealIp) {
    return xRealIp;
  }

  const socketIp = event.node.req.socket?.remoteAddress;
  if (socketIp) {
    return socketIp;
  }

  return 'unknown';
}

function cleanupExpiredBuckets(now: number): void {
  if (now - lastCleanupAt < CLEANUP_INTERVAL_MS) {
    return;
  }

  lastCleanupAt = now;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) {
      buckets.delete(key);
    }
  }
}

export function enforcePublicSearchRateLimit(event: H3Event, routeKey: string): void {
  const config = useRuntimeConfig();
  const windowMs = parsePositiveInteger(config.fallbackRateLimitWindowMs, 60 * 1000);
  const maxRequests = parsePositiveInteger(config.fallbackRateLimitMaxRequests, 300);
  const clientIp = getClientIp(event);
  const now = Date.now();

  cleanupExpiredBuckets(now);

  const bucketKey = `${routeKey}:${clientIp}`;
  const current = buckets.get(bucketKey);

  if (!current || current.resetAt <= now) {
    buckets.set(bucketKey, {
      count: 1,
      resetAt: now + windowMs,
    });
    return;
  }

  current.count += 1;
  if (current.count > maxRequests) {
    throw createError({
      statusCode: 429,
      statusMessage: 'Too many requests. Please try again later.',
    });
  }
}
