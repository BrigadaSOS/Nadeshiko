import { Request, Response, NextFunction } from 'express';
import { InvalidJsonError } from '@lib/utils/apiErrors';

export const handleJsonParseErrors = (err: any, req: Request, res: Response, next: NextFunction): void => {
  if (err instanceof SyntaxError && 'body' in err) {
    const error = new InvalidJsonError('Invalid JSON in request body');
    error.instance = req.requestId || 'unknown';
    res.status(error.status).json(error.toJSON());
    return;
  }
  next(err);
};
