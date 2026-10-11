/** Expose which 429 limit fired: burst limits are retryable, while monthly quota is not. The explicit reason avoids
 * requiring clients to parse a body to distinguish them. */
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

/** Expose these headers to cross-origin SDK clients so monthly-quota errors are distinguishable from burst limits. */
export const QUOTA_HEADERS = [
  RATE_LIMIT_REASON_HEADER,
  'X-Monthly-Quota-Limit',
  'X-Monthly-Quota-Used',
  'X-Monthly-Quota-Reset',
] as const;
