import { ApiError } from '@app/errors';

export class InvalidCredentialsError extends ApiError {
  readonly code = 'INVALID_CREDENTIALS' as const;
  readonly title = 'Invalid Credentials';
  readonly status = 400;
  static readonly DEFAULT_DETAIL = 'Invalid email or password.';

  constructor(detail = InvalidCredentialsError.DEFAULT_DETAIL) {
    super(detail);
  }
}
