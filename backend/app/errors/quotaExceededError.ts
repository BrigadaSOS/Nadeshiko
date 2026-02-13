import { ApiError } from '@app/errors';

export class QuotaExceededError extends ApiError {
  readonly code = 'QUOTA_EXCEEDED' as const;
  readonly title = 'Quota Exceeded';
  readonly status = 429;
  static readonly DEFAULT_DETAIL = 'API Key quota exceeded for this month.';

  constructor(detail = QuotaExceededError.DEFAULT_DETAIL) {
    super(detail);
  }
}
