import { ApiError } from './apiError';
import type { RateLimitReason } from '@lib/rateLimitReason';

export class QuotaExceededError extends ApiError {
  readonly code = 'QUOTA_EXCEEDED' as const;
  readonly title = 'Quota Exceeded';
  readonly status = 429;
  static readonly DEFAULT_DETAIL = 'API Key quota exceeded for this month.';

  /** See `RateLimitExceededError.reason`. */
  readonly reason: RateLimitReason;

  constructor(detail = QuotaExceededError.DEFAULT_DETAIL, reason: RateLimitReason = 'monthly_quota') {
    super(detail);
    this.reason = reason;
  }
}
