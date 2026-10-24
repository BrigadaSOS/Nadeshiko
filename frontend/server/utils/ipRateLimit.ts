import cluster from 'node:cluster';
import { isIPv4, isIPv6 } from 'node:net';
import type { H3Event } from 'h3';
import { createError, setResponseHeader } from 'h3';
import { getClientIp } from './clientIp';

type Bucket = { count: number; windowStart: number; windowMs: number };

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
// Memory ceiling. Past it the oldest live buckets are dropped, which only resets a count; reaching it needs this
// many distinct IPv4 addresses or /56 prefixes inside one window.
const MAX_BUCKETS = 50_000;

function getOrCreate(key: string, windowMs: number, now: number): Bucket {
  const existing = buckets.get(key);
  if (existing && now - existing.windowStart < windowMs) return existing;
  // Re-insert so Map order follows window start: expired buckets collect at the front and eviction stops at the
  // first live one instead of scanning every key.
  buckets.delete(key);
  const fresh: Bucket = { count: 0, windowStart: now, windowMs };
  buckets.set(key, fresh);
  for (const [k, b] of buckets) {
    if (buckets.size <= MAX_BUCKETS && now - b.windowStart < b.windowMs) break;
    buckets.delete(k);
  }
  return fresh;
}

const IPV6_SUBNET_BITS = 56;

function ipv6Groups(ip: string): number[] | null {
  let address = ip;
  // An embedded dotted quad occupies the last two groups.
  const dotted = /(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(address);
  if (dotted) {
    const [a, b, c, d] = dotted.slice(1).map(Number) as [number, number, number, number];
    address = `${address.slice(0, dotted.index)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const [head = '', tail] = address.split('::');
  const parse = (part: string) => (part ? part.split(':').map((g) => Number.parseInt(g, 16)) : []);
  const left = parse(head);
  const right = tail === undefined ? [] : parse(tail);
  const groups = tail === undefined ? left : [...left, ...Array(8 - left.length - right.length).fill(0), ...right];
  return groups.length === 8 && groups.every((g) => Number.isInteger(g) && g >= 0 && g <= 0xffff) ? groups : null;
}

// Mirror the backend's express-rate-limit ipKeyGenerator(ip, 56): one IPv6 customer usually holds at least a /64,
// so per-address buckets are free to rotate. IPv4-mapped addresses count as their IPv4 address.
export function rateLimitSubject(ip: string): string {
  const bare = ip.replace(/^\[|\]$/g, '').split('%', 1)[0] ?? '';
  if (isIPv4(bare) || !isIPv6(bare)) return ip;
  const groups = ipv6Groups(bare);
  if (!groups) return ip;

  const [g0, g1, g2, g3, g4, g5, g6 = 0, g7 = 0] = groups;
  const v4 = `${g6 >> 8}.${g6 & 0xff}.${g7 >> 8}.${g7 & 0xff}`;
  if (!g0 && !g1 && !g2 && !g3 && !g4 && g5 === 0xffff) return v4;
  // Deprecated IPv4-compatible notation (::1.2.3.4); `::` and `::1` share the range, so the dotted form decides.
  if (bare.includes('.') && !g0 && !g1 && !g2 && !g3 && !g4 && !g5) return v4;

  const prefix = [g0, g1, g2, (g3 ?? 0) & 0xff00].map((g) => (g ?? 0).toString(16)).join(':');
  return `${prefix}::/${IPV6_SUBNET_BITS}`;
}

function clientKey(event: H3Event): string {
  return rateLimitSubject(getClientIp(event));
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

// Test-only -- DO NOT call from prod code
export function _ipRateLimitBucketCountForTests(): number {
  return buckets.size;
}
