/**
 * Record CSP refusals so opaque fetch failures can be distinguished from unreachable hosts. Events and
 * promise rejections are unordered; query a bounded log by URL and request start time rather than awaiting an
 * event that may never arrive.
 */

/** One recorded refusal. Mirrors the fields of `SecurityPolicyViolationEvent`. */
export interface CspViolation {
  /**
   * Browsers may truncate cross-origin blocked URLs to their origin for privacy; matching therefore uses
   * origins.
   */
  blockedURI: string;
  /** The directive that refused it, e.g. `connect-src`. */
  effectiveDirective: string;
  /** `Date.now()` when it was recorded. */
  at: number;
}

/** Bound tab-lifetime log growth; callers only need recent refusals. */
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
  /** Match refusals at or after the request's start time so old violations cannot explain a new failure. */
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
 * Install lazily and once on the client. Keep the document-lifetime listener so recorded refusals remain
 * available to later failure handlers.
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
