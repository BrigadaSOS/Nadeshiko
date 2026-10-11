import { Request, Response, NextFunction } from 'express';

/** Capture response bodies for pino-http; pino-http performs the actual logging. */
export function responseBodyLogger(_req: Request, res: Response, next: NextFunction): void {
  const originalJson = res.json.bind(res);
  const originalSend = res.send.bind(res);

  // Override res.json to capture response body for pino serializer
  res.json = (body: unknown) => {
    res.responseBody = body;
    return originalJson(body);
  };

  // Override res.send to capture response body for pino serializer
  res.send = (body: unknown) => {
    res.responseBody = body;
    return originalSend(body);
  };

  next();
}
