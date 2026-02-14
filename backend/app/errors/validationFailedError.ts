import { ApiError } from './apiError';

export class ValidationFailedError extends ApiError {
  readonly code = 'VALIDATION_FAILED' as const;
  readonly title = 'Validation Failed';
  readonly status = 400;
  static readonly DEFAULT_DETAIL =
    'The request data did not pass validation rules. Please check the errors field for details.';

  constructor(fields?: Record<string, string>) {
    super(ValidationFailedError.DEFAULT_DETAIL);
    if (fields) {
      this.errors = fields;
    }
  }
}

export function isValidationError(error: unknown): error is ValidationFailedError {
  return error instanceof ValidationFailedError;
}
