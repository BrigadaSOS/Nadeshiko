// Error handling utilities
// When adding new error codes:
// 1. Create exception class with code, title, status, and default detail
// 2. Create example file in docs/openapi/components/examples/ErrorCodeName.yaml
// 3. Update relevant response files to include the new example
// NOTE: Keep manual sync between backend code and OpenAPI examples

export { ApiError, isApiError } from './apiError';

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
