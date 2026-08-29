/**
 * A fixed number of slots for expensive work, handed out on request and given
 * back when the work is done. The whole of the mechanism behind
 * `server/middleware/99-ssr-admission.ts`; kept apart from it so the counting
 * can be tested without h3 in the room.
 *
 * WHY A CAP ON CONCURRENCY AND NOT A RATE. A rate limit asks "how many did this
 * caller send", which is the wrong question for a flood spread over a hundred
 * thousand addresses at one request each -- 2026-08-30 22:15 UTC, 110,340
 * search renders from 108,685 IPs in 45 minutes. Nobody exceeded any per-IP
 * budget. What broke was that every one of them was accepted: the single Nitro
 * process queued 40-90 renders a second against a ceiling it had measured at
 * ~6.4, latencies climbed past the proxy's 30s timeout, and the CPU went on
 * rendering pages that had already been abandoned. The box sat at 61-74% CPU
 * while serving 189 successful search pages out of 60,000 requests.
 *
 * A concurrency cap asks the only question that matters for that failure: "am
 * I already doing as much of this as I can". Past the cap the answer is an
 * immediate 503, which costs microseconds, tells the client (and a crawler)
 * exactly what happened, and leaves the cores for the renders already admitted.
 * Throughput under a flood then stays at the ceiling instead of falling to
 * zero, which is the difference between "search is slow for a minute" and
 * "the site is down".
 */
export interface AdmissionGate {
  /** Slots in total. */
  readonly max: number;
  /** Slots currently held. */
  inFlight(): number;
  /**
   * A release function when a slot was free, `null` when the gate is full.
   *
   * The release is idempotent on purpose: the middleware wires it to both
   * `finish` and `close` on the response, because a request that finishes
   * cleanly fires both and one that is aborted fires only the second, and a
   * slot leaked on an abort is a slot the flood never gives back.
   */
  tryAcquire(): (() => void) | null;
}

export function createAdmissionGate(max: number): AdmissionGate {
  if (!Number.isInteger(max) || max < 1) {
    throw new RangeError(`An admission gate needs a positive whole number of slots, got ${max}`);
  }

  let inFlight = 0;

  return {
    max,
    inFlight: () => inFlight,
    tryAcquire() {
      if (inFlight >= max) return null;
      inFlight += 1;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        inFlight -= 1;
      };
    },
  };
}
