import type { H3Event } from 'h3';
import { createShirabeClient } from '@shirabe-org/api';
import { logger } from '~~/server/utils/logger';
import { shirabeServiceToken } from '~~/server/utils/shirabeService';

/**
 * One way to reach Shirabe, for every route that needs it.
 *
 * The circuit breaker below is process state shared by every lookup request.
 *
 * It is a server util and not a browser fetch because of the bearer. Shirabe
 * authenticates with a short-lived OAuth bearer that never reaches the visitor.
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
  /** For the log line when the direct path is parked. */
  subject: string;
  /** The original server event, used only when the shared OAuth bearer is needed. */
  event?: H3Event;
  /**
   * Ask as a READER rather than as us.
   *
   * A reader who linked their Shirabe account has a bearer of their own, and
   * Shirabe shapes a lookup by the dictionary stack of whoever's bearer made the
   * call -- which is the entire point of linking. Omitted means the shared bearer,
   * which is every anonymous lookup and the fallback for every failed one.
   *
   * It rides through here rather than through a second HTTP client so both kinds
   * of call share the tailnet fast path and, more importantly, the breaker
   * below: two clients would each have to learn about an outage separately, and
   * each would pay its own timeout finding out.
   */
  accessToken?: string;
  /**
   * A generated SDK endpoint invocation. It owns the endpoint path, request
   * serialization and response/error shape.
   */
  clientCall: (client: ReturnType<typeof createShirabeClient>) => Promise<{
    data?: unknown;
    error?: unknown;
    response?: Response;
  }>;
}

/**
 * Call Shirabe, preferring the tailnet and falling back to the public host.
 *
 * Throws an SDK-shaped failure with its `response`, so the caller can read
 * the status and content type when a request fails.
 */
export async function callShirabe<T>(request: ShirabeRequest): Promise<T> {
  const config = useRuntimeConfig();
  const base = String(config.shirabeApiBase || 'https://shirabe.org').replace(/\/$/, '');
  // A reader's delegated bearer when one was passed, shared client-credentials
  // bearer otherwise. The latter is minted by the backend, where the OAuth
  // client secret lives; neither bearer reaches the browser.

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

  const serviceClient = createShirabeClient({
    baseUrl: base,
    accessToken: () => shirabeServiceToken(request.event),
    fetch: sdkFetchWithFallback({ direct, base, subject: request.subject }),
  });
  const client = request.accessToken?.trim() ? serviceClient.asUser(request.accessToken.trim()) : serviceClient;
  const result = await request.clientCall(client);
  if (result.error || result.data === undefined) {
    const error = Object.assign(new Error('Shirabe SDK request failed'), {
      response: result.response,
      detail: result.error,
    });
    throw error;
  }
  return result.data as T;
}

/**
 * The generated SDK owns serialization, authentication and response parsing.
 * This adapter owns only the network topology: try the tailnet origin first,
 * then transparently use the public endpoint for any route-level failure.
 */
function sdkFetchWithFallback({
  direct,
  base,
  subject,
}: {
  direct: string;
  base: string;
  subject: string;
}): typeof fetch {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = input instanceof Request && init === undefined ? input : new Request(input, init);
    const relative = new URL(request.url);
    const call = async (origin: string, timeout: number): Promise<Response> => {
      const url = new URL(`${relative.pathname}${relative.search}`, origin);
      const copy = request.clone();
      // Node's Request constructor requires `duplex: "half"` when handed a
      // ReadableStream body.  Replaying bytes instead makes this adapter work
      // in Nitro and in the SDK transport tests without relying on that
      // Node-specific escape hatch.  The generated client already encoded the
      // body and its content type; we preserve both exactly.
      const body = copy.method === 'GET' || copy.method === 'HEAD' ? undefined : await copy.arrayBuffer();
      return await fetch(
        new Request(url, {
          method: copy.method,
          headers: copy.headers,
          body,
          signal: AbortSignal.timeout(timeout),
        }),
      );
    };

    const now = Date.now();
    if (direct && !directIsParked(now)) {
      try {
        const response = await call(direct, DIRECT_TIMEOUT_MS);
        if (response.status === 404) return response;
        if (response.ok) {
          recordDirectSuccess();
          return response;
        }
        const cooldown = recordDirectFailure(now);
        logger.warn(
          { status: response.status, subject, cooldownMs: cooldown, failures: breaker.consecutiveFailures },
          'Shirabe direct SDK call failed, parking the tailnet path and using the public host',
        );
      } catch (error) {
        const cooldown = recordDirectFailure(now);
        logger.warn(
          { err: error, subject, cooldownMs: cooldown, failures: breaker.consecutiveFailures },
          'Shirabe direct SDK call failed, parking the tailnet path and using the public host',
        );
      }
    }
    return await call(base, PUBLIC_TIMEOUT_MS);
  };
}

export const __testing = { BREAKER_BASE_MS, BREAKER_MAX_MS, breaker };
