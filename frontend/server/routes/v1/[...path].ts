import { createError, getRequestURL } from 'h3';
import { enforceIpRateLimit, hasDotSegment, v1LimitFor } from '~~/server/utils/v1ProxyPolicy';
import { proxyToBackend } from '~~/server/utils/backendProxy';
import { isServerOnlyProxyRoute } from '~~/server/utils/serverOnlyProxyRoute';

// Refuse generated server-only routes before proxy stamping: a browser relay would otherwise acquire the
// internal secret needed to read credentials or invoke server-only actions. Return 403 because the route exists.
export default defineEventHandler(async (event) => {
  const method = event.node.req.method || 'GET';
  const { pathname } = getRequestURL(event);
  await enforceIpRateLimit(event, v1LimitFor(method, pathname));

  if (hasDotSegment(event.node.req.originalUrl || event.node.req.url || '')) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid path' });
  }

  if (isServerOnlyProxyRoute(method, pathname)) {
    throw createError({
      statusCode: 403,
      statusMessage: 'This route is only callable by the Nadeshiko frontend server',
    });
  }

  return await proxyToBackend(event);
});
