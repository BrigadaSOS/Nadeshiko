/**
 * Remembers `securitypolicyviolation` events for long enough that a rejected
 * `fetch` can say WHY it was rejected.
 *
 * `fetch` reports a request the Content Security Policy refused exactly as it
 * reports a host that is not listening: an opaque `TypeError` with no reason on
 * it. For AnkiConnect that collapses two opposite situations into one message.
 * "Anki is closed" is the reader's to fix and the panel already tells them how;
 * "your server address is not one our policy allows" is OURS, is invisible from
 * the outside, and no amount of restarting Anki will move it. Every one of the
 * 93 failures recorded between the event shipping on 2026-08-26 and 2026-08-29
 * came in as `unreachable`, and not one of them can be told apart after the
 * fact.
 *
 * The browser does say which it was, just not on the promise: a blocked request
 * fires `securitypolicyviolation` on the document, carrying the blocked URI and
 * the directive that refused it. Catching those as they happen and asking
 * afterwards is the only way to join the two halves back together.
 *
 * WHY A LOG AND NOT A PROMISE. The violation event and the `fetch` rejection are
 * separate tasks and the specification does not order them, so a caller that
 * waited for the event might wait forever on a request that failed for an
 * ordinary reason. Recording every violation and letting the failure path ask
 * "was there one for this URL, after I started?" inverts that: the answer is
 * cheap, it is always available, and no is a real answer rather than a timeout.
 *
 * Everything here is pure apart from `installCspViolationLog`, so the matching
 * can be tested without a browser or a policy.
 */

/** One recorded refusal. Mirrors the fields of `SecurityPolicyViolationEvent`. */
export interface CspViolation {
  /**
   * What the browser said it blocked.
   *
   * Not necessarily the URL that was requested: for a cross-origin request the
   * browser truncates this to the origin to avoid leaking a path back to the
   * page, so `http://127.0.0.1:8765/foo` is reported as `http://127.0.0.1:8765`.
   * Matching is done on origin for that reason -- see `originOf`.
   */
  blockedURI: string;
  /** The directive that refused it, e.g. `connect-src`. */
  effectiveDirective: string;
  /** `Date.now()` when it was recorded. */
  at: number;
}

/**
 * How many refusals to keep.
 *
 * A page under a misconfigured policy can produce these in bulk -- one reader's
 * extension generated 100 in a single session -- and the only ones anybody asks
 * about are the most recent. Bounded so a long-lived tab cannot grow this
 * without limit.
 */
export const CSP_VIOLATION_LOG_LIMIT = 30;

/**
 * The origin of a URL, or null if it cannot be parsed.
 *
 * Null rather than a throw because both sides of a comparison come from
 * somewhere untrusted: `blockedURI` can be a bare scheme (`data`, `inline`,
 * `blob`) rather than a URL at all, and the address it is compared against is
 * typed by the reader.
 */
export function originOf(value: string): string | null {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

/**
 * Whether a recorded refusal is the one that killed a request to `url`.
 *
 * Origin equality, not string equality, because `blockedURI` may have been
 * truncated to the origin before we ever saw it.
 */
export function violationMatchesUrl(violation: CspViolation, url: string): boolean {
  const wanted = originOf(url);
  if (wanted === null) return false;
  return originOf(violation.blockedURI) === wanted;
}

export interface CspViolationLog {
  /** Records a refusal. Oldest entries fall off past `CSP_VIOLATION_LOG_LIMIT`. */
  record(violation: CspViolation): void;
  /**
   * Whether a request to `url` was refused by the policy at or after `since`.
   *
   * `since` is what makes this safe to ask repeatedly: without it a refusal
   * from ten minutes ago would answer for a request that has only just failed.
   * Callers pass the time they started their own request.
   */
  refusedSince(url: string, since: number): boolean;
  /** Everything currently held, oldest first. Exposed for tests and debugging. */
  entries(): readonly CspViolation[];
}

export function createCspViolationLog(limit: number = CSP_VIOLATION_LOG_LIMIT): CspViolationLog {
  const log: CspViolation[] = [];

  return {
    record(violation: CspViolation): void {
      log.push(violation);
      // Trimmed after the push rather than guarded before it, so the newest
      // entry always survives even when the log is already full.
      if (log.length > limit) log.splice(0, log.length - limit);
    },

    refusedSince(url: string, since: number): boolean {
      // `>=` and not `>`: a request refused inside the same millisecond it was
      // issued is the normal case for a policy refusal, which the browser
      // decides without touching the network.
      return log.some((violation) => violation.at >= since && violationMatchesUrl(violation, url));
    },

    entries(): readonly CspViolation[] {
      return log;
    },
  };
}

/** The log the app shares. Empty and inert until `installCspViolationLog` runs. */
export const cspViolationLog = createCspViolationLog();

let installed = false;

/**
 * Starts recording into `cspViolationLog`.
 *
 * Idempotent and safe to call from anywhere on the client -- callers reach for
 * this lazily, at the point they are about to make a request whose refusal they
 * want to explain, rather than the app paying for a listener it may never ask
 * about.
 *
 * The listener is never removed. It outlives any single request by design: the
 * whole point is that the answer is already there when the failure path asks.
 */
export function installCspViolationLog(): void {
  if (installed || typeof document === 'undefined') return;
  installed = true;

  document.addEventListener('securitypolicyviolation', (event: SecurityPolicyViolationEvent) => {
    cspViolationLog.record({
      blockedURI: event.blockedURI,
      // `effectiveDirective` is the one that actually did the refusing;
      // `violatedDirective` is deprecated and repeats the whole source list.
      effectiveDirective: event.effectiveDirective,
      at: Date.now(),
    });
  });
}
