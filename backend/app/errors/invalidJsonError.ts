import { ApiError } from './apiError';

export class InvalidJsonError extends ApiError {
  readonly code = 'INVALID_JSON' as const;
  readonly title = 'Invalid JSON';
  readonly status = 400;
  static readonly DEFAULT_DETAIL = 'Invalid JSON in request body';

  constructor(detail = InvalidJsonError.DEFAULT_DETAIL) {
    super(detail);
  }
}
