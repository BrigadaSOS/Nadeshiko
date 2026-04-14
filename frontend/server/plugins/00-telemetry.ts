import { context as otelContext, metrics } from '@opentelemetry/api';
import { getRPCMetadata, RPCType } from '@opentelemetry/core';
import { normalizeRoute, isIgnoredPath } from '~~/route-normalization.mjs';

const activeRequests = metrics.getMeter('nadeshiko-frontend').createUpDownCounter('http.server.active_requests', {
  description: 'Number of active HTTP server requests',
  unit: '{request}',
});

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
    activeRequests.add(1, { 'http.request.method': method });
    event.node.res.on('finish', () => {
      activeRequests.add(-1, { 'http.request.method': method });
    });
  });

  nitroApp.hooks.hook('beforeResponse', (event) => {
    if (event.context._otelIgnored) return;

    const matchedPath = event.context.matchedRoute?.path;
    const route = matchedPath && !isCatchAll(matchedPath)
      ? matchedPath
      : normalizeRoute(event.path || event.node.req.url || '/');

    const rpcMetadata = getRPCMetadata(otelContext.active());
    if (rpcMetadata?.type === RPCType.HTTP) {
      rpcMetadata.route = route;
    }
  });
});
