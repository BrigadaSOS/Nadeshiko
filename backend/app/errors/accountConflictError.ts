import { ApiError } from '@app/errors';

export class AccountConflictError extends ApiError {
  readonly code = 'ACCOUNT_CONFLICT' as const;
  readonly title = 'Account Conflict';
  readonly status = 409;
  static readonly DEFAULT_DETAIL = 'An account with this email already exists.';

  constructor(detail = AccountConflictError.DEFAULT_DETAIL) {
    super(detail);
  }
}
