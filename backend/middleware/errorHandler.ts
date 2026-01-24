import { Request, Response, NextFunction } from 'express';
import { ExpressRuntimeError } from '@nahkies/typescript-express-runtime/errors';
import { logger } from '../utils/log';
import { ApiError, ValidationFailedError, isApiError } from '../utils/apiErrors';

export function handleErrors(error: Error, req: Request, res: Response, next: NextFunction) {
  if (res.headersSent) {
    return next(error);
  }

  // Get requestId for logging and error response
  const requestId = req.requestId || 'unknown';

  // Handle ExpressRuntimeError from the generated routes
  if (error instanceof ExpressRuntimeError) {
    const apiError = convertExpressRuntimeError(error, requestId);
    return res.status(apiError.status).json(apiError.toJSON());
  }

  // Handle ApiError thrown directly (from middleware, etc.)
  if (isApiError(error)) {
    // Attach requestId to the error for response
    if (!error.instance) {
      error.instance = requestId;
    }

    if (error.status >= 500) {
      logger.error({ err: error, requestId }, 'Server error');
    }
    return res.status(error.status).json(error.toJSON());
  }

  // Unknown error - log and return 500
  logger.error({ err: error, requestId }, 'Unhandled error');
  const internalError = createInternalError(requestId);
  return res.status(500).json(internalError.toJSON());
}

function convertExpressRuntimeError(error: ExpressRuntimeError, requestId: string): ApiError {
  const cause = error.cause;

  switch (error.phase) {
    case 'request_validation':
      // Validation failed before handler - return 400 with details
      return createValidationError(cause, requestId);

    case 'request_handler':
      // Error thrown in handler - check if it's our ApiError
      if (isApiError(cause)) {
        // Attach requestId to the error
        if (!cause.instance) {
          cause.instance = requestId;
        }
        return cause;
      }
      // Unknown error from handler
      logger.error({ err: cause, requestId }, 'Unhandled error in handler');
      return createInternalError(requestId);

    case 'response_validation':
      // Response validation failed - server bug
      logger.error({ err: cause, requestId }, 'Response validation failed');
      return createInternalError(requestId);

    default:
      return createInternalError(requestId);
  }
}

function createValidationError(cause: unknown, requestId: string): ValidationFailedError {
  // Handle Zod errors
  if (cause && typeof cause === 'object' && 'issues' in cause) {
    const zodError = cause as { issues: Array<{ path: unknown[]; message: string }> };
    const fields: Record<string, string> = {};
    for (const issue of zodError.issues) {
      const field = issue.path.join('.') || 'body';
      fields[field] = issue.message;
    }
    const validationError = new ValidationFailedError(fields);
    validationError.instance = requestId;
    return validationError;
  }

  // Fallback for unknown validation errors
  const validationError = new ValidationFailedError();
  validationError.instance = requestId;
  return validationError;
}

function createInternalError(requestId: string): ApiError {
  class InternalError extends ApiError {
    readonly code = 'INTERNAL_SERVER_EXCEPTION' as const;
    readonly title = 'Internal Server Error';
    readonly status = 500;
  }
  const error = new InternalError('An internal error occurred');
  error.instance = requestId;
  return error;
}
