import { ApiError } from './apiError';

export class AuthCredentialsInvalidError extends ApiError {
  readonly code = 'AUTH_CREDENTIALS_INVALID' as const;
  readonly title = 'Invalid Authentication Credentials';
  readonly status = 401;
  static readonly DEFAULT_DETAIL =
    'The provided API key or session credentials are invalid. Please check your credentials and try again.';

  constructor(detail = AuthCredentialsInvalidError.DEFAULT_DETAIL) {
    super(detail);
  }
}
