import { Request, Response, NextFunction } from 'express';
import { ValidationError } from '../utils/error';

export const handleJsonParseErrors = (err: any, _req: Request, res: Response, next: NextFunction): void => {
  if (err instanceof SyntaxError && 'body' in err) {
    const error = new ValidationError('Invalid JSON in request body');
    res.status(error.getStatus()).json(error.toJSON());
    return;
  }
  next(err);
};
