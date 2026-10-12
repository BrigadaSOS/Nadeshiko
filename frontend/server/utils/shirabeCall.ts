import { createError } from 'h3';
import { logger } from '~~/server/utils/logger';

// Keep credentials server-side and share one circuit breaker across callers.

// Park failed tailnet calls with bounded exponential cooldown so every lookup does not pay a timeout.
// Per-process state is a latency hint; restarting only costs a new probe.
const BREAKER_BASE_MS = 30_000;
const BREAKER_MAX_MS = 5 * 60_000;

const breaker = { openUntil: 0, consecutiveFailures: 0 };

function directIsParked(now: number): boolean {
  return now < breaker.openUntil;
}

function recordDirectFailure(now: number): number {
  breaker.consecutiveFailures += 1;
  const cooldown = Math.min(BREAKER_MAX_MS, BREAKER_BASE_MS * 2 ** (breaker.consecutiveFailures - 1));
  breaker.openUntil = now + cooldown;
  return cooldown;
}

function recordDirectSuccess(): void {
  // A successful probe resets backoff completely so a later outage starts at the base cooldown.
  breaker.consecutiveFailures = 0;
  breaker.openUntil = 0;
}

// Bound direct-path latency so the public fallback starts promptly.
const DIRECT_TIMEOUT_MS = 1500;
const PUBLIC_TIMEOUT_MS = 5000;

export interface ShirabeRequest {
  // Path under /api/v1, without that prefix.
  path: string;
  method?: 'GET' | 'POST';
  query?: Record<string, string>;
  body?: unknown;

  subject: string;
  // Override with a linked reader's key; omitted means service dictionaries. Both use the same breaker.
  apiKey?: string;
}

// Preserve $fetch errors so callers decide whether a 404 means missing content or a broken endpoint.
export async function callShirabe<T>(request: ShirabeRequest): Promise<T> {
  const config = useRuntimeConfig();
  const base = String(config.shirabeApiBase || 'https://shirabe.org').replace(/\/$/, '');
  // The service key remains required for unlinked requests and reader-key fallback.
  const serviceKey = String(config.shirabeApiKey || '').trim();
  if (!serviceKey) throw createError({ statusCode: 503, statusMessage: 'Shirabe lookups are not configured' });
  const apiKey = request.apiKey?.trim() || serviceKey;

  // Prefer the tailnet hop but retain the public host: a shortcut outage should cost latency, not the feature.
  const direct = String(config.shirabeApiDirect || '')
    .trim()
    .replace(/\/$/, '');

  // Shirabe's JSON API is /api/v1, not /v1; the Rails catch-all otherwise returns misleading HTML 404s.
  const path = `/api/v1${request.path}`;

  // Authorize the tailnet address in Shirabe's APP_HOSTS rather than rely on a fetch Host override.
  const call = (origin: string, timeout: number): Promise<T> =>
    $fetch<T>(`${origin}${path}`, {
      method: request.method ?? 'GET',
      headers: { authorization: `Bearer ${apiKey}` },
      query: request.query,
      body: request.body as Record<string, unknown> | undefined,
      timeout,
    });

  const now = Date.now();

  if (direct && !directIsParked(now)) {
    try {
      const answer = await call(direct, DIRECT_TIMEOUT_MS);
      recordDirectSuccess();
      return answer;
    } catch (directError: unknown) {
      // Direct 404s are authoritative and do not open the breaker. Other statuses can indicate a misconfigured shortcut
      // (e.g. Host rejection), so the public fallback must cover reachable-but-wrong direct paths.
      const directStatus = (directError as { response?: { status?: number } })?.response?.status;
      if (directStatus === 404) throw directError;

      const cooldown = recordDirectFailure(now);
      logger.warn(
        { err: directError, subject: request.subject, cooldownMs: cooldown, failures: breaker.consecutiveFailures },
        'Shirabe direct call failed, parking the tailnet path and using the public host',
      );
      return await call(base, PUBLIC_TIMEOUT_MS);
    }
  }

  // The first request after cooldown is the half-open probe; no separate health check is needed.
  return await call(base, PUBLIC_TIMEOUT_MS);
}

// Distinguish JSON subject 404s from HTML catch-all 404s by content type, not status alone.
export function describeFailure(error: unknown): { kind: 'missing' | 'bad-path' | 'failed'; status?: number } {
  const response = (error as { response?: { status?: number; headers?: { get?: (k: string) => string | null } } })
    ?.response;
  const status = response?.status;
  if (status !== 404) return { kind: 'failed', status };

  const contentType = response?.headers?.get?.('content-type') ?? '';
  return { kind: contentType.includes('html') ? 'bad-path' : 'missing', status };
}

export const __testing = { BREAKER_BASE_MS, BREAKER_MAX_MS, breaker };
