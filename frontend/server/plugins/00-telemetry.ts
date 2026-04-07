import { metrics } from '@opentelemetry/api';
import { normalizeRoute, isIgnoredPath } from '../../route-normalization.mjs';

const DURATION_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.075, 0.1, 0.25, 0.5, 0.75, 1, 2.5, 5, 7.5, 10];

const meter = metrics.getMeter('nadeshiko-frontend');

const requestDuration = meter.createHistogram('http.server.request.duration', {
  description: 'Duration of HTTP server requests',
  unit: 's',
  advice: { explicitBucketBoundaries: DURATION_BUCKETS },
});

const activeRequests = meter.createUpDownCounter('http.server.active_requests', {
  description: 'Number of active HTTP server requests',
  unit: '{request}',
});

const responseBodySize = meter.createHistogram('http.server.response.body.size', {
  description: 'Size of HTTP server response bodies',
  unit: 'By',
});

export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('request', (event) => {
    if (isIgnoredPath(event.path || event.node.req.url || '')) {
      event.context._otelIgnored = true;
      return;
    }

    event.context._otelStartTime = performance.now();
    activeRequests.add(1, { 'http.request.method': event.node.req.method || 'UNKNOWN' });
  });

  nitroApp.hooks.hook('afterResponse', (event) => {
    if (event.context._otelIgnored) return;

    const statusCode = event.node.res.statusCode;
    const method = event.node.req.method || 'UNKNOWN';
    const route = normalizeRoute(event.path || event.node.req.url || '/');

    const metricAttrs: Record<string, string | number> = {
      'http.request.method': method,
      'http.route': route,
      'http.response.status_code': statusCode,
    };

    if (statusCode >= 500) {
      metricAttrs['error.type'] = String(statusCode);
    }

    const durationS = (performance.now() - (event.context._otelStartTime as number)) / 1000;
    requestDuration.record(durationS, metricAttrs);
    activeRequests.add(-1, { 'http.request.method': method });

    const resContentLength = event.node.res.getHeader('content-length');
    if (resContentLength) {
      responseBodySize.record(Number(resContentLength), metricAttrs);
    }
  });
});
