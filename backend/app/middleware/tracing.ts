import type { Request, Response, NextFunction } from 'express';
import { getMeter } from '@config/telemetry';

const DURATION_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.075, 0.1, 0.25, 0.5, 0.75, 1, 2.5, 5, 7.5, 10];

const meter = getMeter();

const requestDuration = meter.createHistogram('http.server.request.duration', {
  description: 'Duration of HTTP server requests',
  unit: 's',
  advice: { explicitBucketBoundaries: DURATION_BUCKETS },
});

const activeRequests = meter.createUpDownCounter('http.server.active_requests', {
  description: 'Number of active HTTP server requests',
  unit: '{request}',
});

const requestBodySize = meter.createHistogram('http.server.request.body.size', {
  description: 'Size of HTTP server request bodies',
  unit: 'By',
});

const responseBodySize = meter.createHistogram('http.server.response.body.size', {
  description: 'Size of HTTP server response bodies',
  unit: 'By',
});

function getRoute(req: Request): string {
  return (req.route?.path as string) || req.path;
}

export function tracingMiddleware(req: Request, res: Response, next: NextFunction) {
  const startTime = performance.now();

  activeRequests.add(1, {
    'http.request.method': req.method,
    'url.scheme': req.protocol,
  });

  res.on('finish', () => {
    const durationS = (performance.now() - startTime) / 1000;
    const route = getRoute(req);

    const metricAttrs: Record<string, string | number> = {
      'http.request.method': req.method,
      'http.route': route,
      'http.response.status_code': res.statusCode,
      'url.scheme': req.protocol,
    };

    if (res.statusCode >= 500) {
      metricAttrs['error.type'] = String(res.statusCode);
    }

    requestDuration.record(durationS, metricAttrs);
    activeRequests.add(-1, {
      'http.request.method': req.method,
      'url.scheme': req.protocol,
    });

    const reqContentLength = req.headers['content-length'];
    if (reqContentLength) {
      requestBodySize.record(Number(reqContentLength), metricAttrs);
    }

    const resContentLength = res.getHeader('content-length');
    if (resContentLength) {
      responseBodySize.record(Number(resContentLength), metricAttrs);
    }
  });

  next();
}
