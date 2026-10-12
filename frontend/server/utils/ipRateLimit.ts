import cluster from 'node:cluster';
import type { H3Event } from 'h3';
import { createError, setResponseHeader } from 'h3';
import { getClientIp } from './clientIp';

type Bucket = { count: number; windowStart: number };

export interface IpRateLimitOptions {
  windowMs: number;
  // Service-wide limit; each process applies its share because buckets are process-local.
  max: number;
  route?: string; // disambiguates multiple limiters sharing the same IP key
}

// Only divide inside an actual cluster worker. Nitro presets are baked at build time, so configured worker counts
// can be inert in a node-server build.
function workerCount(): number {
  if (!cluster.isWorker) return 1;
  const configured = Number(process.env.NITRO_CLUSTER_WORKERS);
  return Number.isFinite(configured) && configured >= 1 ? Math.floor(configured) : 1;
}

// Round up to avoid making the requested limit stricter. Process-local buckets approximate, not enforce, a global total.
export function perWorkerMax(max: number): number {
  return Math.max(1, Math.ceil(max / workerCount()));
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
  return getClientIp(event);
}

function safeSetHeader(event: H3Event, name: string, value: string): void {
  setResponseHeader(event, name, value);
}

// Returns an error for the caller to throw and stamps rate-limit headers.
export async function ipRateLimit(
  event: H3Event,
  opts: IpRateLimitOptions,
): Promise<null | ReturnType<typeof createError>> {
  const now = Date.now();
  const ip = clientKey(event);
  const key = `${opts.route ?? '_'}|${ip}`;
  const bucket = getOrCreate(key, opts.windowMs, now);
  bucket.count += 1;

  const max = perWorkerMax(opts.max);
  const remaining = Math.max(0, max - bucket.count);
  // Advertise this process's share, the ceiling a client pinned to it actually encounters.
  safeSetHeader(event, 'X-RateLimit-Limit', String(max));
  safeSetHeader(event, 'X-RateLimit-Remaining', String(remaining));
  safeSetHeader(event, 'X-RateLimit-Reset', String(Math.ceil((bucket.windowStart + opts.windowMs) / 1000)));

  if (bucket.count > max) {
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
export function _resetIpRateLimitForTests(): void {
  buckets.clear();
}
