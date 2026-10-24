import { createError, getRequestURL } from 'h3';
import { enforceIpRateLimit, hasDotSegment, v1LimitFor } from '~~/server/utils/v1ProxyPolicy';
import { proxyToBackend } from '~~/server/utils/backendProxy';

// The forwarded path can resolve out of /v1/auth (`/v1/auth/%2e%2e/feedback`), so bucket by it and refuse dot
// segments rather than trusting the route Nitro matched.
export default defineEventHandler(async (event) => {
  await enforceIpRateLimit(event, v1LimitFor(event.node.req.method || 'GET', getRequestURL(event).pathname));

  if (hasDotSegment(event.node.req.originalUrl || event.node.req.url || '')) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid path' });
  }

  return await proxyToBackend(event);
});
