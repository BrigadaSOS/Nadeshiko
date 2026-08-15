import cluster from 'node:cluster';
import type { H3Event } from 'h3';
import { createError, setResponseHeader } from 'h3';
import { getClientIp } from './clientIp';

type Bucket = { count: number; windowStart: number };

export interface IpRateLimitOptions {
  windowMs: number;
  /**
   * The limit for the whole service, not for this process.
   *
   * Buckets live in a per-process `Map`, so under cluster mode each worker only
   * ever sees a share of a visitor's requests and `perWorkerMax` divides this
   * down accordingly. Callers state the number they actually mean and the
   * division happens here, against the worker count that is really running.
   */
  max: number;
  route?: string; // disambiguates multiple limiters sharing the same IP key
}

/**
 * How many processes are sharing this limit.
 *
 * Read from the runtime rather than configured, because configuring it is how it
 * goes wrong. Production ran for months with `NITRO_CLUSTER_WORKERS=3` and
 * `NITRO_PRESET=node_cluster` set in `deploy.prod.yml` while serving from a
 * SINGLE process -- Nitro bakes its preset in at BUILD time, and
 * `nuxt.config.ts` hardcodes `preset: 'node-server'`, so the runtime variables
 * were inert. The deploy file had already divided every limit by three to
 * compensate for workers that were never started, so every limit was a third of
 * its documented intent: HTML 20/min where the comment claimed 60. Googlebot met
 * it on 12.9% of its requests and bingbot on 27.9%.
 *
 * `cluster.isWorker` is the honest test: it is true only inside a process that
 * was actually forked, so a mis-set env var cannot inflate the divisor again.
 */
function workerCount(): number {
  if (!cluster.isWorker) return 1;
  const configured = Number(process.env.NITRO_CLUSTER_WORKERS);
  return Number.isFinite(configured) && configured >= 1 ? Math.floor(configured) : 1;
}

/**
 * The per-process share of a service-wide limit.
 *
 * Rounded UP, and never below 1: rounding down would make the real ceiling
 * quietly stricter than the number asked for, which is the failure this whole
 * mechanism exists to stop repeating.
 *
 * This still only approximates the intended total, and deliberately so -- an
 * exact answer needs a store the workers share, which is a bigger change than
 * this file. What it guarantees is a floor: a visitor pinned to one worker gets
 * at least `max / workers`, and one spread evenly gets about `max`.
 */
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

  const max = perWorkerMax(opts.max);
  const remaining = Math.max(0, max - bucket.count);
  // The advertised limit is this process's share, because that is the number the
  // client will actually meet here. Advertising the service-wide total would
  // promise headroom a pinned client never gets.
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
export function _resetForTests(): void {
  buckets.clear();
}
