// Error handling utilities
// When adding new error codes:
// 1. Create exception class below with code, title, status, and default detail
// 2. Create example file in docs/openapi/components/examples/ErrorCodeName.yaml
// 3. Update relevant response files to include the new example
// NOTE: Keep manual sync between backend code and OpenAPI examples

// Configuration for error type URIs
const GITHUB_ISSUES_URL = 'https://github.com/BrigadaSOS/Nadeshiko/issues/new?template=bug_report.yml';

// ============================================================================
// Base Error Class
// ============================================================================

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
  readonly instance?: string;
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

// ============================================================================
// Validation Error (with field-level errors)
// ============================================================================

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

// ============================================================================
// 400 Bad Request Errors
// ============================================================================

export class InvalidCredentialsError extends ApiError {
  readonly code = 'INVALID_CREDENTIALS' as const;
  readonly title = 'Invalid Credentials';
  readonly status = 400;
  static readonly DEFAULT_DETAIL = 'Invalid email or password.';

  constructor(detail = InvalidCredentialsError.DEFAULT_DETAIL) {
    super(detail);
  }
}

export class InvalidJsonError extends ApiError {
  readonly code = 'INVALID_JSON' as const;
  readonly title = 'Invalid JSON';
  readonly status = 400;
  static readonly DEFAULT_DETAIL = 'Invalid JSON in request body';

  constructor(detail = InvalidJsonError.DEFAULT_DETAIL) {
    super(detail);
  }
}

export class InvalidRequestError extends ApiError {
  readonly code = 'INVALID_REQUEST' as const;
  readonly title = 'Invalid Request';
  readonly status = 400;
  static readonly DEFAULT_DETAIL = 'The request is invalid or malformed.';

  constructor(detail = InvalidRequestError.DEFAULT_DETAIL) {
    super(detail);
  }
}

// ============================================================================
// 401 Unauthorized Errors
// ============================================================================

export class AuthCredentialsRequiredError extends ApiError {
  readonly code = 'AUTH_CREDENTIALS_REQUIRED' as const;
  readonly title = 'Authentication Credentials Required';
  readonly status = 401;
  static readonly DEFAULT_DETAIL =
    'No API key or JWT token was provided. Please include an X-API-Key header or a valid Authorization Bearer token.';

  constructor(detail = AuthCredentialsRequiredError.DEFAULT_DETAIL) {
    super(detail);
  }
}

export class AuthCredentialsInvalidError extends ApiError {
  readonly code = 'AUTH_CREDENTIALS_INVALID' as const;
  readonly title = 'Invalid Authentication Credentials';
  readonly status = 401;
  static readonly DEFAULT_DETAIL =
    'The provided API key or JWT token is invalid. Please check your credentials and try again.';

  constructor(detail = AuthCredentialsInvalidError.DEFAULT_DETAIL) {
    super(detail);
  }
}

export class AuthCredentialsExpiredError extends ApiError {
  readonly code = 'AUTH_CREDENTIALS_EXPIRED' as const;
  readonly title = 'Expired Authentication Credentials';
  readonly status = 401;
  static readonly DEFAULT_DETAIL = 'Your session has expired. Please log in again to obtain a new JWT token.';

  constructor(detail = AuthCredentialsExpiredError.DEFAULT_DETAIL) {
    super(detail);
  }
}

export class EmailNotVerifiedError extends ApiError {
  readonly code = 'EMAIL_NOT_VERIFIED' as const;
  readonly title = 'Email Not Verified';
  readonly status = 401;
  static readonly DEFAULT_DETAIL = 'Please verify your email address before continuing.';

  constructor(detail = EmailNotVerifiedError.DEFAULT_DETAIL) {
    super(detail);
  }
}

export class AccessDeniedError extends ApiError {
  readonly code = 'ACCESS_DENIED' as const;
  readonly title = 'Access Denied';
  readonly status = 401;
  static readonly DEFAULT_DETAIL = 'You do not have access to this resource.';

  constructor(detail = AccessDeniedError.DEFAULT_DETAIL) {
    super(detail);
  }
}

// ============================================================================
// 403 Forbidden Errors
// ============================================================================

export class InsufficientPermissionsError extends ApiError {
  readonly code = 'INSUFFICIENT_PERMISSIONS' as const;
  readonly title = 'Insufficient Permissions';
  readonly status = 403;
  static readonly DEFAULT_DETAIL = 'Access forbidden: missing the following permissions: {permissions}.';

  constructor(detail = InsufficientPermissionsError.DEFAULT_DETAIL) {
    super(detail);
  }
}

// ============================================================================
// 404 Not Found Errors
// ============================================================================

export class NotFoundError extends ApiError {
  readonly code = 'NOT_FOUND' as const;
  readonly title = 'Not Found';
  readonly status = 404;
  static readonly DEFAULT_DETAIL = 'The requested resource was not found.';

  constructor(detail = NotFoundError.DEFAULT_DETAIL) {
    super(detail);
  }
}

export class UserNotFoundError extends ApiError {
  readonly code = 'USER_NOT_FOUND' as const;
  readonly title = 'User Not Found';
  readonly status = 404;
  static readonly DEFAULT_DETAIL = 'User not found.';

  constructor(detail = UserNotFoundError.DEFAULT_DETAIL) {
    super(detail);
  }
}

// ============================================================================
// 409 Conflict Errors
// ============================================================================

export class AccountConflictError extends ApiError {
  readonly code = 'ACCOUNT_CONFLICT' as const;
  readonly title = 'Account Conflict';
  readonly status = 409;
  static readonly DEFAULT_DETAIL = 'An account with this email already exists.';

  constructor(detail = AccountConflictError.DEFAULT_DETAIL) {
    super(detail);
  }
}

// ============================================================================
// 429 Too Many Requests Errors
// ============================================================================

export class RateLimitExceededError extends ApiError {
  readonly code = 'RATE_LIMIT_EXCEEDED' as const;
  readonly title = 'Rate Limit Exceeded';
  readonly status = 429;
  static readonly DEFAULT_DETAIL = 'Too many requests. Please try again later.';

  constructor(detail = RateLimitExceededError.DEFAULT_DETAIL) {
    super(detail);
  }
}

export class QuotaExceededError extends ApiError {
  readonly code = 'QUOTA_EXCEEDED' as const;
  readonly title = 'Quota Exceeded';
  readonly status = 429;
  static readonly DEFAULT_DETAIL = 'API Key quota exceeded for this month.';

  constructor(detail = QuotaExceededError.DEFAULT_DETAIL) {
    super(detail);
  }
}

// ============================================================================
// 500 Internal Server Error
// ============================================================================

export class InternalServerError extends ApiError {
  readonly code = 'INTERNAL_SERVER_EXCEPTION' as const;
  readonly title = 'Internal Server Error';
  readonly status = 500;
  static readonly DEFAULT_DETAIL = 'An unexpected error occurred. Please try again later.';

  constructor(detail = InternalServerError.DEFAULT_DETAIL) {
    super(detail);
  }
}

// ============================================================================
// Type guards
// ============================================================================

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

export function isValidationError(error: unknown): error is ValidationFailedError {
  return error instanceof ValidationFailedError;
}

// ============================================================================
// Error Code Types
// ============================================================================

export type ErrorCodeType =
  | 'ACCESS_DENIED'
  | 'ACCOUNT_CONFLICT'
  | 'AUTH_CREDENTIALS_EXPIRED'
  | 'AUTH_CREDENTIALS_INVALID'
  | 'AUTH_CREDENTIALS_REQUIRED'
  | 'EMAIL_NOT_VERIFIED'
  | 'INSUFFICIENT_PERMISSIONS'
  | 'INTERNAL_SERVER_EXCEPTION'
  | 'INVALID_CREDENTIALS'
  | 'INVALID_JSON'
  | 'INVALID_REQUEST'
  | 'NOT_FOUND'
  | 'QUOTA_EXCEEDED'
  | 'RATE_LIMIT_EXCEEDED'
  | 'USER_NOT_FOUND'
  | 'VALIDATION_FAILED';
