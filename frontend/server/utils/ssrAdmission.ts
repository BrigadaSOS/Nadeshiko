// Bound concurrent renders, not requests per IP: distributed floods can stay below every per-IP budget
// while exhausting SSR capacity.
export interface AdmissionGate {
  readonly max: number;

  inFlight(): number;
  // Release is idempotent: middleware listens to both finish and close, including aborted responses.
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
