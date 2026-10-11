import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { ServiceOverloadedError } from '@app/errors';
import { getMeter } from '@config/telemetry';

/** Cap concurrent work for direct API-key callers; per-IP limits cannot stop distributed floods, and release slots
 * on both finish and close. */
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

const admittedGauge = getMeter().createObservableGauge('http.server.admission.in_flight', {
  description: 'Slots currently occupied in the request admission gate',
  unit: '{request}',
});
const capacityGauge = getMeter().createObservableGauge('http.server.admission.capacity', {
  description: 'Maximum simultaneous requests admitted for a scope',
  unit: '{request}',
});

/** Seed every scope at zero and heartbeat the delta series; otherwise “never throttled” is missing data, not zero. */
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
  admittedGauge.addCallback((result) => result.observe(inFlight, { scope }));
  capacityGauge.addCallback((result) => result.observe(max, { scope }));

  const handler = (req: Request, res: Response, next: NextFunction): void => {
    // Do not acquire a slot after an earlier disconnect; auth may already have emitted `close`, so the release listener
    // would be too late.
    if (req.aborted || res.destroyed || res.writableEnded) return;

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
