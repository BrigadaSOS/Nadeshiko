import { ApiError } from './apiError';

/**
 * 503 for a request refused at the door because the service is already doing
 * as much of this kind of work as it can.
 *
 * Not a rate limit, and deliberately not a 429: nothing about the CALLER is
 * being counted, only how busy we are, so there is no budget the caller could
 * have stayed inside and no `X-RateLimit-Reason` to give. The honest answer is
 * "not right now", which is what 503 plus `Retry-After` says to browsers, SDK
 * retry policies and crawlers alike. Raised by `inFlightLimit`.
 */
export class ServiceOverloadedError extends ApiError {
  readonly code = 'SERVICE_OVERLOADED' as const;
  readonly title = 'Service Overloaded';
  readonly status = 503;
  static readonly DEFAULT_DETAIL = 'The service is busy. Please retry in a moment.';

  constructor(detail = ServiceOverloadedError.DEFAULT_DETAIL) {
    super(detail);
  }
}
