import { Request, Response, NextFunction } from 'express';

/**
 * Middleware to capture response bodies for logging via pino-http.
 * Stores the body on res.responseBody for the pino serializer to access.
 * The actual logging is handled by pino-http, not this middleware.
 */
export function responseBodyLogger(req: Request, res: Response, next: NextFunction): void {
  // Store original res.json and res.send
  const originalJson = res.json.bind(res);
  const originalSend = res.send.bind(res);

  // Override res.json to capture response body for pino serializer
  res.json = function (body: any) {
    (res as any).responseBody = body;
    return originalJson(body);
  } as any;

  // Override res.send to capture response body for pino serializer
  res.send = function (body: any) {
    (res as any).responseBody = body;
    return originalSend(body);
  } as any;

  next();
}
