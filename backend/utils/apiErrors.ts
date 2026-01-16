/**
 * API Error factory functions using OpenAPI-generated types
 * Standardized error responses that match the OpenAPI schema
 */

import type { t_Error } from '../generated/models';

// Error code type from the generated union type
type ErrorCode = t_Error['error'];

export const badRequest = (message: string, details?: unknown): t_Error => {
  const result: t_Error = {
    error: 'BAD_REQUEST',
    message,
  };
  if (details !== undefined) {
    result.details = details as { [key: string]: unknown };
  }
  return result;
};

export const unauthorized = (message: string = 'Unauthorized', details?: unknown): t_Error => {
  const result: t_Error = {
    error: 'UNAUTHORIZED',
    message,
  };
  if (details !== undefined) {
    result.details = details as { [key: string]: unknown };
  }
  return result;
};

export const forbidden = (message: string = 'Forbidden', details?: unknown): t_Error => {
  const result: t_Error = {
    error: 'FORBIDDEN',
    message,
  };
  if (details !== undefined) {
    result.details = details as { [key: string]: unknown };
  }
  return result;
};

export const notFound = (message: string, details?: unknown): t_Error => {
  const result: t_Error = {
    error: 'NOT_FOUND',
    message,
  };
  if (details !== undefined) {
    result.details = details as { [key: string]: unknown };
  }
  return result;
};

export const internalServerError = (message: string = 'Internal server error', details?: unknown): t_Error => {
  const result: t_Error = {
    error: 'INTERNAL_SERVER_ERROR',
    message,
  };
  if (details !== undefined) {
    result.details = details as { [key: string]: unknown };
  }
  return result;
};

// Type-safe status code mapping using the enum
const statusCodeMap: Record<ErrorCode, number> = {
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  INTERNAL_SERVER_ERROR: 500
};

export function getStatusCode(error: t_Error): number {
  return statusCodeMap[error.error] ?? 500;
}

// Type guard to check for specific error types
export function isErrorCode(error: t_Error, code: ErrorCode): boolean {
  return error.error === code;
}

// Helper to determine error type from error object or Error instance
export function toErrorResponse(error: unknown): t_Error {
  if (typeof error === 'object' && error !== null && 'error' in error) {
    return error as t_Error;
  }
  if (error instanceof Error) {
    return internalServerError(error.message);
  }
  return internalServerError('An unexpected error occurred');
}
