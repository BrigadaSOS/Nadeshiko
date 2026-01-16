import { NextFunction, Request, Response } from 'express';
import type { t_Error } from '../generated/models';
import { notFound, internalServerError, getStatusCode, toErrorResponse } from '../utils/apiErrors';
import { StatusCodes } from 'http-status-codes';

export const handleErrors = (error: Error | t_Error, _req: Request, res: Response, _next: NextFunction) => {
  // Handle OpenAPI error objects (plain objects with error field)
  if ('error' in error && typeof error.error === 'string') {
    return res.status(getStatusCode(error as t_Error)).json(error);
  }

  // Handle file not found errors (ENOENT)
  if (error.message?.includes('ENOENT')) {
    const filePath = (error as NodeJS.ErrnoException).path;
    const notFoundError = notFound(`File not found: ${filePath}`);
    return res.status(StatusCodes.NOT_FOUND).json(notFoundError);
  }

  // Handle generic errors - convert to internal server error
  const serverError = internalServerError(error.message || 'An unexpected error occurred');
  return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json(serverError);
};
