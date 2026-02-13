import { ApiError } from '@app/errors';

export class RateLimitExceededError extends ApiError {
  readonly code = 'RATE_LIMIT_EXCEEDED' as const;
  readonly title = 'Rate Limit Exceeded';
  readonly status = 429;
  static readonly DEFAULT_DETAIL = 'Too many requests. Please try again later.';

  constructor(detail = RateLimitExceededError.DEFAULT_DETAIL) {
    super(detail);
  }
}
