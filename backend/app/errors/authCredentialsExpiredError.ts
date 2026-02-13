import { ApiError } from '@app/errors';

export class AuthCredentialsExpiredError extends ApiError {
  readonly code = 'AUTH_CREDENTIALS_EXPIRED' as const;
  readonly title = 'Expired Authentication Credentials';
  readonly status = 401;
  static readonly DEFAULT_DETAIL = 'Your session has expired. Please log in again.';

  constructor(detail = AuthCredentialsExpiredError.DEFAULT_DETAIL) {
    super(detail);
  }
}
