import { Request, Response, NextFunction } from 'express';
import { GeneralError, ErrorCode } from '../utils/error';
import { StatusCodes } from 'http-status-codes';

const GITHUB_BUG_URL = 'https://github.com/BrigadaSOS/Nadeshiko/issues/new?template=bug_report.md';

interface InternalErrorResponse {
  error: {
    message: string;
    code: ErrorCode;
    report: {
      github: string;
    };
  };
}

export const handleErrors = (error: Error, _req: Request, res: Response, next: NextFunction) => {
  // If headers already sent, delegate to Express default error handler which will close the
  // connection and fail the request. This is for cases like when an error is thrown
  // mid-stream, when headers are already set beforehand
  if (res.headersSent) {
    return next(error);
  }

  // Handle our domain errors
  if (error instanceof GeneralError) {
    return res.status(error.getStatus()).json(error.toJSON());
  }

  // Everything else is an unexpected error - return generic 500
  // (pino-http will log the error automatically)

  const response: InternalErrorResponse = {
    error: {
      message: 'An internal error occurred',
      code: ErrorCode.INTERNAL_ERROR,
      report: { github: GITHUB_BUG_URL },
    },
  };
  return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json(response);
};
