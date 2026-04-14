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

const ID_PATTERN = /^[0-9]+$|^[0-9a-f]{8,}$/i;
const NANOID_PATTERN = /^[A-Za-z0-9_-]{8,}$/;

function isIdSegment(seg: string): boolean {
  if (ID_PATTERN.test(seg)) return true;
  if (seg.length >= 8 && NANOID_PATTERN.test(seg) && /[0-9]/.test(seg) && /[A-Za-z]/.test(seg)) return true;
  return false;
}

function normalizePathIds(path: string): string {
  return path
    .split('/')
    .map((s) => (s !== '' && isIdSegment(s) ? ':id' : s))
    .join('/');
}

function getRoute(req: Request): string {
  if (req.route?.path) return req.route.path as string;
  // Fallback: normalize raw path to collapse IDs and prevent cardinality explosion
  return normalizePathIds(req.path);
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
