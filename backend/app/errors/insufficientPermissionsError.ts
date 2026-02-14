import { ApiError } from './apiError';

export class InsufficientPermissionsError extends ApiError {
  readonly code = 'INSUFFICIENT_PERMISSIONS' as const;
  readonly title = 'Insufficient Permissions';
  readonly status = 403;
  static readonly DEFAULT_DETAIL = 'Access forbidden: missing the following permissions: {permissions}.';

  constructor(detail = InsufficientPermissionsError.DEFAULT_DETAIL) {
    super(detail);
  }
}
