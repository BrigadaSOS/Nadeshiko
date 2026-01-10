import { Request, Response, NextFunction } from 'express';
import { ExpressRuntimeError } from '@nahkies/typescript-express-runtime/errors';
import { EntityNotFoundError } from 'typeorm';
import { logger } from '@lib/utils/log';
import { ApiError, ValidationFailedError, NotFoundError, isApiError } from '@lib/utils/apiErrors';

export function handleErrors(error: Error, req: Request, res: Response, next: NextFunction) {
  if (res.headersSent) {
    return next(error);
  }

  // Get requestId for logging and error response
  const requestId = req.requestId || 'unknown';

  // Handle TypeORM EntityNotFoundError - convert to 404 with specific message
  if (error instanceof EntityNotFoundError) {
    const notFoundError = parseEntityNotFoundError(error);
    notFoundError.instance = requestId;
    return res.status(404).json(notFoundError.toJSON());
  }

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
      // Handle TypeORM EntityNotFoundError from handler
      if (cause instanceof EntityNotFoundError) {
        const notFoundError = parseEntityNotFoundError(cause);
        notFoundError.instance = requestId;
        return notFoundError;
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

function parseEntityNotFoundError(error: EntityNotFoundError): NotFoundError {
  // TypeORM error message format: "Could not find any entity of type "User" matching: ..."
  const message = error.message;
  const match = message.match(/type "(\w+)" matching/);

  if (match) {
    const entityName = match[1];
    const detail = entityNameToDetail(entityName);
    return new NotFoundError(detail);
  }

  // Fallback to generic message if parsing fails
  return new NotFoundError();
}

function entityNameToDetail(entityName: string): string {
  const entityMap: Record<string, string> = {
    User: 'User not found',
    Media: 'Media not found',
    Episode: 'Episode not found',
    Segment: 'Segment not found',
    ApiAuth: 'API key not found',
    Role: 'Role not found',
  };

  return entityMap[entityName] ?? `${entityName} not found`;
}
