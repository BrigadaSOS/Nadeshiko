import { ApiError } from './apiError';

export class AccessDeniedError extends ApiError {
  readonly code = 'ACCESS_DENIED' as const;
  readonly title = 'Access Denied';
  readonly status = 401;
  static readonly DEFAULT_DETAIL = 'You do not have access to this resource.';

  constructor(detail = AccessDeniedError.DEFAULT_DETAIL) {
    super(detail);
  }
}
