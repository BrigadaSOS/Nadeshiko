import { ApiError } from '@app/errors';

export class NotFoundError extends ApiError {
  readonly code = 'NOT_FOUND' as const;
  readonly title = 'Not Found';
  readonly status = 404;
  static readonly DEFAULT_DETAIL = 'The requested resource was not found.';

  constructor(detail = NotFoundError.DEFAULT_DETAIL) {
    super(detail);
  }

  static forUser(): NotFoundError {
    return new NotFoundError('User not found.');
  }
}
