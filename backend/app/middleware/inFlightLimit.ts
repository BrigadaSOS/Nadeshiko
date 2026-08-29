import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { ServiceOverloadedError } from '@app/errors';
import { getMeter } from '@config/telemetry';

/**
 * A cap on how many requests of one kind are being served at the same time.
 *
 * WHY THIS AND NOT (ONLY) THE PER-IP LIMITERS. On 2026-08-30 a crawler spread
 * 110,340 search renders over 108,685 addresses in 45 minutes -- one request
 * each. No per-IP budget was exceeded anywhere in the stack, and every request
 * was accepted: /v1/search went from ~50ms to p50 596ms / p95 10.9s, not
 * because Elasticsearch was out of CPU (it was at 40%) but because its search
 * pool on a 4-core box has 7 threads and everything else queued behind them.
 * The frontend renders waiting on those answers then ran past the proxy's 30s
 * timeout, and the origin spent the next half hour computing responses nobody
 * would receive.
 *
 * A concurrency cap is the only control that speaks to that failure. Past it,
 * the answer is an immediate 503 with `Retry-After` -- microseconds, honest,
 * and it leaves the pool to the searches already running, so throughput under
 * a flood holds at the ceiling instead of falling to nothing.
 *
 * THE FRONTEND HAS ITS OWN CAP (server/middleware/99-ssr-admission.ts) on page
 * renders, and under normal shapes of load that one trips first: 2 workers x 8
 * renders, each of which makes at most 2 calls here (search + stats), is 32
 * concurrent searches at the very most -- which is exactly the default for
 * SEARCH_MAX_INFLIGHT. So site traffic never meets this limiter; it is here
 * for the callers the frontend cannot see, which is anyone holding an API key
 * and pointing it at api.nadeshiko.co directly.
 *
 * COUNTED PER PROCESS. The backend runs one, so this is also the service-wide
 * number; if that changes, the cap has to be divided the way the frontend's
 * `perWorkerMax` divides its own.
 *
 * Released on `finish` AND `close`, and idempotently, because an aborted request
 * fires only the second and a slot leaked on an abort is a slot the flood never
 * gives back.
 */
export interface InFlightLimitOptions {
  /** Names the series on the `http.server.overloaded` counter. */
  scope: string;
  max: number;
  /** What to tell the client, in seconds. Two is one render's worth of patience. */
  retryAfterSeconds?: number;
}

export interface InFlightLimit extends RequestHandler {
  inFlight(): number;
  readonly max: number;
}

const overloadedCount = getMeter().createCounter('http.server.overloaded', {
  description: 'Requests refused because the in-flight cap for their scope was already reached',
  unit: '{request}',
});

/**
 * Every scope that exists, so the zero-series can be seeded before anything is
 * refused -- for the same reason `seedRateLimitSeries` exists: a delta counter
 * that has never been touched has no series, and a rule reading it sees NO DATA
 * rather than zero. Registered by `createInFlightLimit`, emitted by the series
 * heartbeat in @config/telemetry.
 */
const scopes = new Set<string>();

export function seedInFlightLimitSeries(): void {
  for (const scope of scopes) {
    overloadedCount.add(0, { scope });
  }
}

export function createInFlightLimit({ scope, max, retryAfterSeconds = 2 }: InFlightLimitOptions): InFlightLimit {
  if (!Number.isInteger(max) || max < 1) {
    throw new RangeError(`An in-flight limit needs a positive whole number, got ${max}`);
  }
  scopes.add(scope);

  let inFlight = 0;

  const handler = (_req: Request, res: Response, next: NextFunction): void => {
    if (inFlight >= max) {
      overloadedCount.add(1, { scope });
      res.setHeader('Retry-After', String(retryAfterSeconds));
      next(new ServiceOverloadedError());
      return;
    }

    inFlight += 1;
    let released = false;
    const release = (): void => {
      if (released) return;
      released = true;
      inFlight -= 1;
    };
    res.once('finish', release);
    res.once('close', release);
    next();
  };

  return Object.assign(handler, { inFlight: () => inFlight, max });
}
