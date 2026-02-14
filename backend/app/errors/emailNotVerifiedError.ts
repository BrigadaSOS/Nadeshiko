import { ApiError } from './apiError';

export class EmailNotVerifiedError extends ApiError {
  readonly code = 'EMAIL_NOT_VERIFIED' as const;
  readonly title = 'Email Not Verified';
  readonly status = 401;
  static readonly DEFAULT_DETAIL = 'Please verify your email address before continuing.';

  constructor(detail = EmailNotVerifiedError.DEFAULT_DETAIL) {
    super(detail);
  }
}
