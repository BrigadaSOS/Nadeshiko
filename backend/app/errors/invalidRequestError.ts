import { ApiError } from '@app/errors';

export class InvalidRequestError extends ApiError {
  readonly code = 'INVALID_REQUEST' as const;
  readonly title = 'Invalid Request';
  readonly status = 400;
  static readonly DEFAULT_DETAIL = 'The request is invalid or malformed.';

  constructor(detail = InvalidRequestError.DEFAULT_DETAIL) {
    super(detail);
  }
}
