import { ApiError } from './apiError';
import type { RateLimitReason } from '@lib/rateLimitReason';

export class RateLimitExceededError extends ApiError {
  readonly code = 'RATE_LIMIT_EXCEEDED' as const;
  readonly title = 'Rate Limit Exceeded';
  readonly status = 429;
  static readonly DEFAULT_DETAIL = 'Too many requests. Please try again later.';

  /** Carry the limiter reason on the error so the central handler emits the same header whether Express or the
   * API-key path raised it. */
  readonly reason: RateLimitReason;

  constructor(detail = RateLimitExceededError.DEFAULT_DETAIL, reason: RateLimitReason = 'ip_burst') {
    super(detail);
    this.reason = reason;
  }
}
