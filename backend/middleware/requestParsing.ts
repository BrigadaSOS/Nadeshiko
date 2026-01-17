import { Request, Response, NextFunction } from 'express';
import { InvalidJsonError } from '../utils/apiErrors';

export const handleJsonParseErrors = (err: any, _req: Request, res: Response, next: NextFunction): void => {
  if (err instanceof SyntaxError && 'body' in err) {
    const error = new InvalidJsonError('Invalid JSON in request body');
    res.status(error.status).json(error.toJSON());
    return;
  }
  next(err);
};
