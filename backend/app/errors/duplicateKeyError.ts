import { ApiError } from './apiError';

/** 409: the resource (or the unique key it would take) already exists. Thrown for Postgres unique violations, and by
 * handlers that refuse a write that would replace an existing row. */
export class DuplicateKeyError extends ApiError {
  readonly code = 'DUPLICATE_KEY' as const;
  readonly title = 'Resource already exists';
  readonly status = 409;
}
