// Error handling utilities
// When adding new error codes:
// 1. Create exception class with code, title, status, and default detail
// 2. Create example file in docs/openapi/components/examples/ErrorCodeName.yaml
// 3. Update relevant response files to include the new example
// NOTE: Keep manual sync between backend code and OpenAPI examples

const GITHUB_ISSUES_URL = 'https://github.com/BrigadaSOS/Nadeshiko/issues/new?template=bug_report.yml';

interface ErrorResponse {
  code: string;
  title: string;
  detail: string;
  type: string;
  status: number;
  instance?: string;
  errors?: Record<string, string>;
}

export abstract class ApiError extends Error {
  abstract readonly code: string;
  abstract readonly title: string;
  abstract readonly status: number;
  readonly type: string = GITHUB_ISSUES_URL;
  instance?: string;
  protected errors?: Record<string, string>;

  constructor(detail: string) {
    super(detail);
    this.name = this.constructor.name;
  }

  toJSON(): ErrorResponse {
    const response: ErrorResponse = {
      code: this.code,
      title: this.title,
      detail: this.message,
      type: this.type,
      status: this.status,
    };

    if (this.instance) {
      response.instance = this.instance;
    }

    if (this.errors) {
      response.errors = this.errors;
    }

    return response;
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

export { ValidationFailedError, isValidationError } from './validationFailedError';
export { InvalidCredentialsError } from './invalidCredentialsError';
export { InvalidJsonError } from './invalidJsonError';
export { InvalidRequestError } from './invalidRequestError';
export { AuthCredentialsRequiredError } from './authCredentialsRequiredError';
export { AuthCredentialsInvalidError } from './authCredentialsInvalidError';
export { AuthCredentialsExpiredError } from './authCredentialsExpiredError';
export { EmailNotVerifiedError } from './emailNotVerifiedError';
export { AccessDeniedError } from './accessDeniedError';
export { InsufficientPermissionsError } from './insufficientPermissionsError';
export { NotFoundError } from './notFoundError';
export { AccountConflictError } from './accountConflictError';
export { RateLimitExceededError } from './rateLimitExceededError';
export { QuotaExceededError } from './quotaExceededError';
export { InternalServerError } from './internalServerError';
