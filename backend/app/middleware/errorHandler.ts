import { Request, Response, NextFunction } from 'express';
import { ExpressRuntimeError } from '@nahkies/typescript-express-runtime/errors';
import { EntityNotFoundError, QueryFailedError, TypeORMError } from 'typeorm';
import { trace } from '@opentelemetry/api';
import { logger } from '@config/log';
import { ApiError, ValidationFailedError, NotFoundError, InternalServerError, isApiError } from '@app/errors';
import { recordError, recordClientError } from '@app/lib/errorFingerprint';
import { routeErrorCodes } from 'generated/errorProfiles';

type PgDriverError = {
  code?: string;
  constraint?: string;
  table?: string;
};

export function handleErrors(error: Error, req: Request, res: Response, next: NextFunction) {
  if (res.headersSent) {
    return next(error);
  }

  // Get requestId for logging and error response
  const requestId = req.requestId || 'unknown';

  // Handle TypeORM QueryFailedError - check for duplicate key violations
  if (error instanceof QueryFailedError) {
    const mappedError = mapQueryFailedError(error, requestId);
    if (mappedError) {
      recordClientError(error, mappedError.code, { 'http.route': req.route?.path ?? req.path });
      return res.status(mappedError.status).json(mappedError.toJSON());
    }
    // Other query errors - log as warning (might be expected)
    const fp = recordRealException(error, req);
    logger.warn(
      { err: error, requestId, 'error.fingerprint': fp.fingerprint, 'error.group': fp.group },
      'Database query failed',
    );
    return res.status(500).json(createInternalError(requestId).toJSON());
  }

  // Handle TypeORM EntityNotFoundError - convert to 404 with specific message
  if (error instanceof EntityNotFoundError) {
    const notFoundError = parseEntityNotFoundError(error);
    notFoundError.instance = requestId;
    recordClientError(error, 'NOT_FOUND', { 'http.route': req.route?.path ?? req.path });
    return res.status(404).json(notFoundError.toJSON());
  }

  // Handle ExpressRuntimeError from the generated routes
  if (error instanceof ExpressRuntimeError) {
    const apiError = convertExpressRuntimeError(error, requestId, req);
    return res.status(apiError.status).json(apiError.toJSON());
  }

  // Handle ApiError thrown directly (from middleware, etc.)
  if (isApiError(error)) {
    // Attach requestId to the error for response
    if (!error.instance) {
      error.instance = requestId;
    }

    if (error.status >= 500) {
      const fp = recordRealException(error, req);
      logger.error(
        { err: error, requestId, 'error.fingerprint': fp.fingerprint, 'error.group': fp.group },
        'Server error',
      );
    } else if (error.status >= 400) {
      recordClientError(error, error.code, { 'http.route': req.route?.path ?? req.path });
    }

    // Validate error code against documented codes for this route
    const routeKey = `${req.method}:${req.route?.path ?? req.path}`;
    const validCodes = routeErrorCodes.get(routeKey);
    if (!isErrorCodeAllowedForRoute(error.code, validCodes)) {
      logger.error(
        { errorCode: error.code, route: routeKey, requestId },
        'Undocumented error code for this endpoint — returning 500',
      );
      return res.status(500).json(createInternalError(requestId).toJSON());
    }

    return res.status(error.status).json(error.toJSON());
  }

  // Unknown error - log and return 500
  const fp = recordRealException(error, req);
  logger.error(
    { err: error, requestId, 'error.fingerprint': fp.fingerprint, 'error.group': fp.group },
    'Unhandled error',
  );
  const internalError = createInternalError(requestId);
  return res.status(500).json(internalError.toJSON());
}

function isErrorCodeAllowedForRoute(errorCode: string, validCodes: ReadonlySet<string> | undefined): boolean {
  if (!validCodes) return true;
  if (validCodes.has(errorCode)) return true;

  // Duplicate-key DB errors are semantically request validation conflicts.
  if (errorCode === 'DUPLICATE_KEY' && validCodes.has('INVALID_REQUEST')) {
    return true;
  }

  return false;
}

function recordRealException(realError: unknown, req?: Request): { fingerprint: string; group: string } {
  const error = realError instanceof Error ? realError : new Error(String(realError));
  const errorType = realError instanceof Error ? realError.constructor.name : 'UnknownError';

  const attrs: Record<string, string> = {};
  if (req?.route?.path) attrs['http.route'] = req.route.path;

  const result = recordError(error, errorType, attrs);

  const span = trace.getActiveSpan();
  if (span && req?.user) {
    span.setAttribute('enduser.id', String(req.user.id));
  }

  return result;
}

function convertExpressRuntimeError(error: ExpressRuntimeError, requestId: string, req: Request): ApiError {
  const cause = error.cause;

  switch (error.phase) {
    case 'request_validation':
      // Validation failed before handler - return 400 with details
      return createValidationError(cause, requestId);

    case 'request_handler': {
      // Error thrown in handler - check if it's our ApiError
      if (isApiError(cause)) {
        if (!cause.instance) {
          cause.instance = requestId;
        }
        if (cause.status >= 500) {
          recordRealException(cause, req);
        } else if (cause.status >= 400) {
          recordClientError(cause, cause.code, { 'http.route': req.route?.path ?? req.path });
        }
        return cause;
      }
      // Handle TypeORM EntityNotFoundError from handler
      if (cause instanceof EntityNotFoundError) {
        const notFoundError = parseEntityNotFoundError(cause);
        notFoundError.instance = requestId;
        recordClientError(cause, 'NOT_FOUND', { 'http.route': req.route?.path ?? req.path });
        return notFoundError;
      }
      // Handle TypeORM QueryFailedError from handler (duplicate keys, etc.)
      if (cause instanceof QueryFailedError) {
        const mappedError = mapQueryFailedError(cause, requestId);
        if (mappedError) {
          recordClientError(cause, mappedError.code, { 'http.route': req.route?.path ?? req.path });
          return mappedError;
        }
        const fp = recordRealException(cause, req);
        logger.warn(
          { err: cause, requestId, 'error.fingerprint': fp.fingerprint, 'error.group': fp.group },
          'Database query failed in handler',
        );
        return createInternalError(requestId);
      }
      // Handle other TypeORM errors from handler
      if (cause instanceof TypeORMError) {
        const fp = recordRealException(cause, req);
        logger.warn(
          { err: cause, requestId, 'error.fingerprint': fp.fingerprint, 'error.group': fp.group },
          'TypeORM error in handler',
        );
        return createInternalError(requestId);
      }
      // Unknown error from handler
      const fp = recordRealException(cause, req);
      logger.error(
        { err: cause, requestId, 'error.fingerprint': fp.fingerprint, 'error.group': fp.group },
        'Unhandled error in handler',
      );
      return createInternalError(requestId);
    }

    case 'response_validation': {
      // Response validation failed - server bug
      const fp = recordRealException(cause, req);
      logger.error(
        { err: cause, requestId, 'error.fingerprint': fp.fingerprint, 'error.group': fp.group },
        'Response validation failed',
      );
      return createInternalError(requestId);
    }

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

function createInternalError(requestId: string): InternalServerError {
  const error = new InternalServerError();
  error.instance = requestId;
  return error;
}

function parseEntityNotFoundError(error: EntityNotFoundError): NotFoundError {
  const entityName = getEntityTargetName(error.entityClass);
  if (entityName) {
    return new NotFoundError(entityNameToDetail(entityName));
  }

  return new NotFoundError();
}

function entityNameToDetail(entityName: string): string {
  const entityMap: Record<string, string> = {
    User: 'User not found',
    Media: 'Media not found',
    Episode: 'Episode not found',
    Segment: 'Segment not found',
    ApiAuth: 'API key not found',
  };

  return entityMap[entityName] ?? `${entityName} not found`;
}

function getEntityTargetName(entityTarget: unknown): string | null {
  if (typeof entityTarget === 'string') {
    const trimmed = entityTarget.trim();
    return trimmed ? trimmed : null;
  }

  if (typeof entityTarget === 'function') {
    return entityTarget.name || null;
  }

  if (!entityTarget || typeof entityTarget !== 'object') {
    return null;
  }

  const maybeNamed = entityTarget as { name?: unknown; options?: { name?: unknown } };

  if (typeof maybeNamed.name === 'string' && maybeNamed.name.trim()) {
    return maybeNamed.name;
  }

  if (typeof maybeNamed.options?.name === 'string' && maybeNamed.options.name.trim()) {
    return maybeNamed.options.name;
  }

  return null;
}

function humanizeResourceName(raw: string): string {
  return raw
    .replace(/^["']|["']$/g, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/_/g, ' ')
    .trim()
    .split(/\s+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

function getResourceNameFromUniqueViolation(driverError: PgDriverError): string | null {
  if (driverError.table) {
    return humanizeResourceName(driverError.table);
  }

  const constraint = driverError.constraint;
  if (!constraint) return null;

  const pkMatch = constraint.match(/^PK_(.+)$/i);
  if (pkMatch?.[1]) {
    return humanizeResourceName(pkMatch[1]);
  }

  const idxMatch = constraint.match(/^IDX_([^_]+)/i);
  if (idxMatch?.[1]) {
    return humanizeResourceName(idxMatch[1]);
  }

  return null;
}

function getMissingResourceNameFromForeignKeyConstraint(constraint: string | undefined): string | null {
  if (!constraint) return null;

  const namedFkMatch = constraint.match(/^FK_[^_]+_(.+)$/i);
  if (namedFkMatch?.[1]) {
    return humanizeResourceName(namedFkMatch[1]);
  }

  const parts = constraint.split('_');
  if (parts.length < 3 || parts[parts.length - 1].toLowerCase() !== 'fkey') {
    return null;
  }

  const idTokenOffset = parts[parts.length - 2].toLowerCase() === 'id' ? 3 : 2;
  const entityToken = parts[parts.length - idTokenOffset];
  return entityToken ? humanizeResourceName(entityToken) : null;
}

function createDuplicateKeyError(driverError: PgDriverError, requestId: string): ApiError {
  class DuplicateKeyError extends ApiError {
    readonly code = 'DUPLICATE_KEY' as const;
    readonly title = 'Resource already exists';
    readonly status = 409;
  }

  const resourceName = getResourceNameFromUniqueViolation(driverError);
  const detail = resourceName
    ? `${resourceName} already exists`
    : 'A resource with this unique identifier already exists';

  const duplicateError = new DuplicateKeyError(detail);
  duplicateError.instance = requestId;
  return duplicateError;
}

function createForeignKeyNotFoundError(driverError: PgDriverError, requestId: string): ApiError {
  const resourceName = getMissingResourceNameFromForeignKeyConstraint(driverError.constraint);
  const detail = resourceName ? `${resourceName} not found` : 'Related resource not found';
  const notFoundError = new NotFoundError(detail);
  notFoundError.instance = requestId;
  return notFoundError;
}

function mapQueryFailedError(error: QueryFailedError, requestId: string): ApiError | null {
  const driverError = error.driverError as PgDriverError | undefined;
  const code = driverError?.code;

  // PostgreSQL unique violation
  if (code === '23505') {
    return createDuplicateKeyError(driverError ?? {}, requestId);
  }

  // PostgreSQL foreign key violation
  if (code === '23503') {
    return createForeignKeyNotFoundError(driverError ?? {}, requestId);
  }

  return null;
}
