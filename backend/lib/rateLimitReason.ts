/**
 * Which limit rejected the request.
 *
 * Four things answer 429 here, and before this the caller could only tell them
 * apart by reading the problem-details `code` -- which separates
 * `QUOTA_EXCEEDED` from `RATE_LIMIT_EXCEEDED` but collapses the two burst
 * limiters into one, and is not something an HTTP client can branch on without
 * parsing a body it may not have asked for.
 *
 * The distinction is the whole diagnostic, because the right response differs:
 * a burst is waited out and retried, a month is not, and retrying a monthly cap
 * just spends the caller's backoff budget against a wall that does not move
 * until the 1st. The support thread this came from opened with "I'm getting
 * 429s" and could not be answered without a database query.
 */
export type RateLimitReason =
  /** `User` monthly allowance, from the tier or an override. Resets next month. */
  | 'monthly_quota'
  /** Per-API-key burst allowance, enforced by better-auth. Resets in seconds. */
  | 'key_burst'
  /** Per-API-key remaining-uses budget, refilled on the key's own schedule. */
  | 'key_usage'
  /** The per-IP limiter in front of the router. Resets within the window. */
  | 'ip_burst';

export const RATE_LIMIT_REASON_HEADER = 'X-RateLimit-Reason';

/**
 * Headers a browser client has to be told it may read.
 *
 * Same-origin responses expose everything; these are listed because the SDK is
 * also used cross-origin by third-party apps holding a scoped key, and without
 * the allowlist their `MonthlyQuotaExceededError` would be indistinguishable
 * from a burst -- the exact thing the header exists to fix.
 */
export const QUOTA_HEADERS = [
  RATE_LIMIT_REASON_HEADER,
  'X-Monthly-Quota-Limit',
  'X-Monthly-Quota-Used',
  'X-Monthly-Quota-Reset',
] as const;
