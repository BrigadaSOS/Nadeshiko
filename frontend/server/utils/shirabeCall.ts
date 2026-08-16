import { createError } from 'h3';
import { logger } from '~~/server/utils/logger';

/**
 * One way to reach Shirabe, for every route that needs it.
 *
 * This used to live inside the word lookup, which was fine while there was one
 * of them. There are two now -- the candidates a token resolves to, and the full
 * detail of the one the reader settled on -- and the circuit breaker below is
 * state: a second copy would be a second breaker, each learning about an outage
 * on its own and each paying its own timeout to find out.
 *
 * It is a server util and not a browser fetch because of the key. Shirabe
 * authenticates with a service key that is ours, not the visitor's, and a key
 * that reaches the browser is a key that has been given away. Same reasoning as
 * `nadeshikoApiKey` in server/utils/backendProxy.ts.
 */

/**
 * Circuit breaker for the tailnet path.
 *
 * Falling back per request is correct but not enough on its own: if the tailnet
 * is down for a while, EVERY uncached lookup pays the direct path's timeout
 * before starting the request that actually works, and the feature this is meant
 * to speed up gets slower than it was before the shortcut existed.
 *
 * So a failure parks the direct path for a cooldown and traffic goes straight to
 * the public host. The cooldown doubles with each consecutive failure, up to a
 * ceiling, so an outage costs one slow request every few minutes rather than one
 * per lookup.
 *
 * State is per server process and deliberately in memory: it is a latency hint,
 * not a correctness one. A restart re-probing the fast path costs one timeout.
 */
const BREAKER_BASE_MS = 30_000;
const BREAKER_MAX_MS = 5 * 60_000;

const breaker = { openUntil: 0, consecutiveFailures: 0 };

/** Open, so the direct path is skipped and the public host answers. */
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
  // Closed again. Reset the backoff rather than decaying it, so one recovered
  // request restores the fast path at full speed instead of leaving the next
  // failure escalating from wherever the last outage stopped.
  breaker.consecutiveFailures = 0;
  breaker.openUntil = 0;
}

/** Short timeout: the direct path answers in tens of milliseconds, so anything
 *  approaching a second means it is not working, and the reader should not wait
 *  out the full budget before the fallback even starts. */
const DIRECT_TIMEOUT_MS = 1500;
const PUBLIC_TIMEOUT_MS = 5000;

export interface ShirabeRequest {
  /** Path under Shirabe's API, WITHOUT the `/api/v1` prefix (`/words/identify`). */
  path: string;
  method?: 'GET' | 'POST';
  query?: Record<string, string>;
  body?: unknown;
  /** For the log line when the direct path is parked. */
  subject: string;
}

/**
 * Call Shirabe, preferring the tailnet and falling back to the public host.
 *
 * Throws whatever `$fetch` threw, so a caller can read `response.status` and
 * decide what a 404 means for its own endpoint -- which differs: a missing word
 * is an ordinary answer, a missing route is a bug. `describeFailure` below is
 * the shared half of that decision.
 */
export async function callShirabe<T>(request: ShirabeRequest): Promise<T> {
  const config = useRuntimeConfig();
  const base = String(config.shirabeApiBase || 'https://shirabe.org').replace(/\/$/, '');
  const apiKey = String(config.shirabeApiKey || '').trim();
  if (!apiKey) throw createError({ statusCode: 503, statusMessage: 'Shirabe lookups are not configured' });

  // Shirabe sits on another Hetzner box in the same city, and the public name
  // resolves to Cloudflare -- so left alone this call goes Helsinki → Cloudflare
  // → Helsinki for ~175ms, against ~33ms of actual work. `shirabeApiDirect` is
  // the tailnet address, which is a direct WireGuard hop.
  //
  // The public URL stays as a fallback rather than being replaced, because this
  // is on the reader's path: the tailnet is one more thing that can be down, and
  // a word popup that fails is worse than a slow one. A tailnet problem should
  // cost latency, not the feature.
  const direct = String(config.shirabeApiDirect || '')
    .trim()
    .replace(/\/$/, '');

  // `/api/v1`, not `/v1`. Shirabe mounts its JSON API under `scope "/api/v1"`
  // (config/routes.rb), and this was once missing the prefix -- so every lookup
  // hit Rails' catch-all and came back 404.
  //
  // That failed convincingly rather than loudly: a 404 reads as "this word has
  // no entry", which is a real and common case, so the word card rendered empty
  // for EVERY word and looked like thin dictionary coverage. Nothing alerted,
  // because an empty card is not an error.
  const path = `/api/v1${request.path}`;

  // Note for anyone tempted to send `Host: shirabe.org` on the direct call so
  // Rails' host authorization accepts it: it does not work. Node's fetch treats
  // Host as a forbidden header and drops it silently, so the request still
  // arrives claiming the bare IP and still 403s. Shirabe lists the tailnet
  // address in APP_HOSTS instead -- the fix belongs on the side that decides
  // which hosts are legitimate.
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
      // A 404 is Shirabe answering about the SUBJECT -- the path is healthy and
      // the public host would say the same thing a round trip later, so rethrow
      // it and leave the breaker closed.
      //
      // Only 404. Every other status is about this path rather than the
      // subject: a 403 is Shirabe rejecting the Host header, a 401 a key it will
      // not take. Treating those as authoritative is what turned a misconfigured
      // shortcut into 502s for readers when the public host would have answered
      // perfectly well -- the fallback has to cover a direct path that is
      // reachable but wrong, not just one that is down.
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

  // Either no direct path configured, or the breaker is open and this request
  // skips the timeout entirely. Once the cooldown lapses the next request probes
  // the direct path again -- that attempt IS the half-open probe, so no separate
  // health check is needed.
  return await call(base, PUBLIC_TIMEOUT_MS);
}

/**
 * What a thrown Shirabe call actually means.
 *
 * A 404 means one of two very different things, and the status code alone cannot
 * tell them apart:
 *
 *   Shirabe's API answering about the SUBJECT -> JSON, and an ordinary result
 *   Rails' catch-all answering about the URL  -> an HTML error page
 *
 * Reading the second as the first is exactly how a wrong API path hid for as
 * long as it did: every card rendered empty and every response said "no entry",
 * which is indistinguishable from a corpus full of proper nouns. Content type is
 * what separates them, so trust it rather than the status.
 */
export function describeFailure(error: unknown): { kind: 'missing' | 'bad-path' | 'failed'; status?: number } {
  const response = (error as { response?: { status?: number; headers?: { get?: (k: string) => string | null } } })
    ?.response;
  const status = response?.status;
  if (status !== 404) return { kind: 'failed', status };

  const contentType = response?.headers?.get?.('content-type') ?? '';
  return { kind: contentType.includes('html') ? 'bad-path' : 'missing', status };
}

export const __testing = { BREAKER_BASE_MS, BREAKER_MAX_MS, breaker };
