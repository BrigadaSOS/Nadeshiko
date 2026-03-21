import { Request, Response, NextFunction } from 'express';

const envOrigins = process.env.ALLOWED_WEBSITE_URLS ? process.env.ALLOWED_WEBSITE_URLS.split(',') : [];
const allowedOrigins = [...new Set([...envOrigins, 'https://old.nadeshiko.co'])];

export const corsMiddleware = (req: Request, res: Response, next: NextFunction): void => {
  const origin: string | undefined = req.headers.origin;

  if (origin && allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }

  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, PATCH, DELETE');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-Requested-With,content-type,traceparent,tracestate,x-api-key,Authorization',
  );
  res.setHeader('Access-Control-Allow-Credentials', 'true');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  next();
};
