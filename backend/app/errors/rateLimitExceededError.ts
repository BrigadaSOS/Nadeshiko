import { ApiError } from './apiError';
import type { RateLimitReason } from '@lib/rateLimitReason';

export class RateLimitExceededError extends ApiError {
  readonly code = 'RATE_LIMIT_EXCEEDED' as const;
  readonly title = 'Rate Limit Exceeded';
  readonly status = 429;
  static readonly DEFAULT_DETAIL = 'Too many requests. Please try again later.';

  /**
   * Which limiter fired, surfaced as `X-RateLimit-Reason` by the error handler.
   *
   * Carried on the error rather than set on the response at the throw site
   * because the two callers that raise this are in different places -- the
   * express limiter has the response, the API-key path does not -- and the
   * header has to read the same either way.
   */
  readonly reason: RateLimitReason;

  constructor(detail = RateLimitExceededError.DEFAULT_DETAIL, reason: RateLimitReason = 'ip_burst') {
    super(detail);
    this.reason = reason;
  }
}
