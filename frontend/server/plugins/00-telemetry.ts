import { type Span, metrics, trace } from '@opentelemetry/api';

const DURATION_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.075, 0.1, 0.25, 0.5, 0.75, 1, 2.5, 5, 7.5, 10];
const namedSpans = new WeakSet<Span>();

const IGNORED_PREFIXES = ['/_i18n/', '/_nuxt/', '/__nuxt'];
const IGNORED_PATHS = ['/up', '/favicon.ico'];

function isIgnoredPath(path: string): boolean {
  if (IGNORED_PATHS.includes(path)) return true;
  return IGNORED_PREFIXES.some((prefix) => path.startsWith(prefix));
}

const ID_SEGMENT = /^[0-9]+$|^[0-9a-f]{8,}$/i;

const ROUTE_PATTERNS: [RegExp, string][] = [
  [/^\/sentence\/[^/]+$/, '/sentence/:id'],
  [/^\/collection\/[^/]+$/, '/collection/:id'],
  [/^\/s\/[^/]+$/, '/s/:id'],
  [/^\/search\/[^/]+$/, '/search/:query'],
  [/^\/_nuxt\//, '/_nuxt/:asset'],
  [/^\/admin\//, '/admin/:slug'],
  [/^\/settings\//, '/settings/:slug'],
  [/^\/user\//, '/user/:slug'],
];

function normalizeRoute(path: string): string {
  const pathWithoutQuery = path.split('?')[0];

  for (const [pattern, template] of ROUTE_PATTERNS) {
    if (pattern.test(pathWithoutQuery)) return template;
  }

  if (pathWithoutQuery.startsWith('/v1/') || pathWithoutQuery.startsWith('/media/')) {
    const segments = pathWithoutQuery.split('/');
    const normalized = segments.map((s) => (ID_SEGMENT.test(s) ? ':id' : s));
    return normalized.join('/');
  }

  return pathWithoutQuery;
}

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
    const rawPath = event.path || event.node.req.url || 'unknown';
    if (isIgnoredPath(rawPath)) {
      event.context._otelIgnored = true;
      return;
    }

    event.context._otelStartTime = performance.now();

    const span = trace.getActiveSpan();
    if (span && !namedSpans.has(span)) {
      namedSpans.add(span);
      const route = normalizeRoute(rawPath);
      event.context._otelRoute = route;
      span.setAttribute('http.target', rawPath);
      span.updateName(`${event.node.req.method} ${route}`);

      const queryString = rawPath.split('?')[1];
      if (queryString) {
        for (const param of queryString.split('&')) {
          const [key, value] = param.split('=');
          if (key && value) {
            span.setAttribute(`url.query.${key}`, decodeURIComponent(value));
          }
        }
      }
    }

    activeRequests.add(1, {
      'http.request.method': event.node.req.method || 'UNKNOWN',
    });
  });

  nitroApp.hooks.hook('afterResponse', (event) => {
    if (event.context._otelIgnored) return;

    const statusCode = event.node.res.statusCode;
    const method = event.node.req.method || 'UNKNOWN';
    const route = (event.context._otelRoute as string) || normalizeRoute(event.path || event.node.req.url || 'unknown');

    const span = trace.getActiveSpan();
    if (span && namedSpans.has(span)) {
      span.setAttribute('http.route', route);
    }

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
