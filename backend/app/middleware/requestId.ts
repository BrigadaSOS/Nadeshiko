import { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';

const REQUEST_ID_PREFIX = 'nade-';

// Extend Express Request type to include requestId
declare module 'express-serve-static-core' {
  interface Request {
    requestId: string;
  }
}

export function requestIdMiddleware(req: Request, _res: Response, next: NextFunction): void {
  req.requestId = `${REQUEST_ID_PREFIX}${randomUUID()}`;
  next();
}
