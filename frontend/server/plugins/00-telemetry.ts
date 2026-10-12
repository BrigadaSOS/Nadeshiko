import { context as otelContext, metrics, trace } from '@opentelemetry/api';
import { getRPCMetadata, RPCType } from '@opentelemetry/core';
import { BOT_FAMILY_ATTRIBUTE, TRAFFIC_ATTRIBUTE, resolveEventTraffic, trafficAttributes } from '#shared/utils/traffic';
import { normalizeRoute, isIgnoredPath } from '~~/route-normalization.mjs';

const meter = metrics.getMeter('nadeshiko-frontend');

const activeRequests = meter.createUpDownCounter('http.server.active_requests', {
  description: 'Number of active HTTP server requests',
  unit: '{request}',
});

// Count traffic classes separately because the auto-instrumented duration histogram cannot carry custom attributes.
const requestCount = meter.createCounter('http.server.requests', {
  description: 'HTTP server requests by traffic type',
  unit: '{request}',
});

// Separate family counts to avoid crossing crawler families with method/status cardinality.
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

// Attach routes from response and error hooks; either may be the only hook reached, and duplicate writes are harmless.
function applyRoute(event?: { context?: Record<string, unknown>; path?: string; node?: { req: { url?: string } } }) {
  if (!event || event.context?._otelIgnored) return;

  const matchedPath = (event.context?.matchedRoute as { path?: string } | undefined)?.path;
  const route =
    matchedPath && !isCatchAll(matchedPath) ? matchedPath : normalizeRoute(event.path || event.node?.req.url || '/');

  const rpcMetadata = getRPCMetadata(otelContext.active());
  if (rpcMetadata?.type === RPCType.HTTP) {
    rpcMetadata.route = route;
  }
}

export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('request', (event) => {
    if (isIgnoredPath(event.path || event.node.req.url || '')) {
      event.context._otelIgnored = true;
      return;
    }

    const method = event.node.req.method || 'UNKNOWN';

    // Resolve once so logs, error hooks and internal calls share the same classification.
    const { traffic, family } = resolveEventTraffic(event);

    const span = trace.getActiveSpan();
    if (span) {
      span.setAttribute(TRAFFIC_ATTRIBUTE, traffic);
      if (family) span.setAttribute(BOT_FAMILY_ATTRIBUTE, family);
    }

    // Increment and decrement with identical attributes or the gauge cannot return to zero.
    const inFlight = { 'http.request.method': method, ...trafficAttributes(traffic, family) };
    if (event.node.res.destroyed || event.node.res.writableEnded) return;
    activeRequests.add(1, inFlight);
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      activeRequests.add(-1, inFlight);
    };
    event.node.res.once('close', release);
    event.node.res.once('finish', () => {
      if (released) return;
      release();
      requestCount.add(1, {
        [TRAFFIC_ATTRIBUTE]: traffic,
        'http.request.method': method,
        'http.status_class': statusClass(event.node.res.statusCode),
      });
      if (family) botRequestCount.add(1, { [BOT_FAMILY_ATTRIBUTE]: family });
    });
  });

  nitroApp.hooks.hook('beforeResponse', (event) => {
    applyRoute(event);
  });

  // Thrown errors skip beforeResponse when Nitro sends its own response. Attach the route in error while the span is active.
  nitroApp.hooks.hook('error', (_error, ctx) => {
    applyRoute(ctx?.event);
  });
});
