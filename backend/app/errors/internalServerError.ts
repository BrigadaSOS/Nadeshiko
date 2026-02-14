import { ApiError } from './apiError';

export class InternalServerError extends ApiError {
  readonly code = 'INTERNAL_SERVER_EXCEPTION' as const;
  readonly title = 'Internal Server Error';
  readonly status = 500;
  static readonly DEFAULT_DETAIL = 'An unexpected error occurred. Please try again later.';

  constructor(detail = InternalServerError.DEFAULT_DETAIL) {
    super(detail);
  }
}
