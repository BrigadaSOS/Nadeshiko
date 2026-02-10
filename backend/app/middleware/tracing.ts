import { trace, SpanKind, SpanStatusCode } from '@opentelemetry/api';
import type { Request, Response, NextFunction } from 'express';

const tracer = trace.getTracer('nadeshiko-backend');

export function tracingMiddleware(req: Request, res: Response, next: NextFunction) {
  tracer.startActiveSpan(
    `${req.method} ${req.path}`,
    { kind: SpanKind.SERVER },
    (span) => {
      span.setAttributes({
        'http.method': req.method,
        'http.url': req.originalUrl,
        'http.request_id': req.requestId,
      });

      res.on('finish', () => {
        span.setAttribute('http.status_code', res.statusCode);
        if (res.statusCode >= 500) {
          span.setStatus({ code: SpanStatusCode.ERROR });
        }
        span.end();
      });

      next();
    },
  );
}
