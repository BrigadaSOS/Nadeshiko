import { ApiError } from './apiError';

/** Use 503, not 429, for service saturation: `Retry-After` describes capacity, not a caller budget. */
export class ServiceOverloadedError extends ApiError {
  readonly code = 'SERVICE_OVERLOADED' as const;
  readonly title = 'Service Overloaded';
  readonly status = 503;
  static readonly DEFAULT_DETAIL = 'The service is busy. Please retry in a moment.';

  constructor(detail = ServiceOverloadedError.DEFAULT_DETAIL) {
    super(detail);
  }
}
