import { ApiError } from '@app/errors';

export class AuthCredentialsRequiredError extends ApiError {
  readonly code = 'AUTH_CREDENTIALS_REQUIRED' as const;
  readonly title = 'Authentication Credentials Required';
  readonly status = 401;
  static readonly DEFAULT_DETAIL =
    'No API key or session credentials were provided. Please include an Authorization Bearer token or a valid session cookie.';

  constructor(detail = AuthCredentialsRequiredError.DEFAULT_DETAIL) {
    super(detail);
  }
}
