import { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';

// Extend Express Request type to include requestId
declare module 'express-serve-static-core' {
  interface Request {
    requestId: string;
  }
}

// Prefix for request IDs - helps identify them in logs and external systems
const REQUEST_ID_PREFIX = 'nade-';

/**
 * Middleware that adds a unique requestId to each request.
 * This ID is included in structured logs and error responses for tracing.
 * Format: nade-<uuid>
 */
export function requestIdMiddleware(req: Request, _res: Response, next: NextFunction): void {
  // Generate a unique ID for this request with a prefix
  req.requestId = `${REQUEST_ID_PREFIX}${randomUUID()}`;
  next();
}
