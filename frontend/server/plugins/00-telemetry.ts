import { context as otelContext, metrics, trace } from '@opentelemetry/api';
import { getRPCMetadata, RPCType } from '@opentelemetry/core';
import { BOT_FAMILY_ATTRIBUTE, TRAFFIC_ATTRIBUTE, resolveEventTraffic, trafficAttributes } from '#shared/utils/traffic';
import { normalizeRoute, isIgnoredPath } from '~~/route-normalization.mjs';

const meter = metrics.getMeter('nadeshiko-frontend');

const activeRequests = meter.createUpDownCounter('http.server.active_requests', {
  description: 'Number of active HTTP server requests',
  unit: '{request}',
});

// This is the surface crawlers actually land on — the backend mostly sees what
// SSR asks for on their behalf — so the reader/bot/monitor split matters most
// here. Kept off the auto-instrumented duration histogram, which cannot carry a
// custom attribute; dividing bot by total here answers "how much of this is
// crawlers", and the histogram still answers "and is it slow".
const requestCount = meter.createCounter('http.server.requests', {
  description: 'HTTP server requests by traffic type',
  unit: '{request}',
});

// The crawler's name on its own counter: ~40 families crossed with method and
// status would be thousands of series to answer a question that needs neither.
const botRequestCount = meter.createCounter('http.server.bot_requests', {
  description: 'HTTP server requests by crawler family',
  unit: '{request}',
});

function statusClass(statusCode: number): string {
  if (statusCode >= 500) return '5xx';
  if (statusCode >= 400) return '4xx';
  if (statusCode >= 300) return '3xx';
  if (statusCode >= 200) return '2xx';
  return '1xx';
}

function isCatchAll(routePath: string): boolean {
  return routePath.includes('**') || routePath.includes('[...');
}

export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('request', (event) => {
    if (isIgnoredPath(event.path || event.node.req.url || '')) {
      event.context._otelIgnored = true;
      return;
    }

    const method = event.node.req.method || 'UNKNOWN';

    // Classified once, here, at the first hook that sees the request: the
    // access log, the error hooks and the SSR calls to the backend all read the
    // memoised answer off `event.context` rather than re-parsing the UA.
    const { traffic, family } = resolveEventTraffic(event);

    const span = trace.getActiveSpan();
    if (span) {
      span.setAttribute(TRAFFIC_ATTRIBUTE, traffic);
      if (family) span.setAttribute(BOT_FAMILY_ATTRIBUTE, family);
    }

    // Identical attributes on both sides of the pair, or the gauge never
    // returns to zero.
    const inFlight = { 'http.request.method': method, ...trafficAttributes(traffic, family) };
    activeRequests.add(1, inFlight);
    event.node.res.on('finish', () => {
      activeRequests.add(-1, inFlight);
      requestCount.add(1, {
        [TRAFFIC_ATTRIBUTE]: traffic,
        'http.request.method': method,
        'http.status_class': statusClass(event.node.res.statusCode),
      });
      if (family) botRequestCount.add(1, { [BOT_FAMILY_ATTRIBUTE]: family });
    });
  });

  nitroApp.hooks.hook('beforeResponse', (event) => {
    if (event.context._otelIgnored) return;

    const matchedPath = event.context.matchedRoute?.path;
    const route =
      matchedPath && !isCatchAll(matchedPath) ? matchedPath : normalizeRoute(event.path || event.node.req.url || '/');

    const rpcMetadata = getRPCMetadata(otelContext.active());
    if (rpcMetadata?.type === RPCType.HTTP) {
      rpcMetadata.route = route;
    }
  });
});
