import { createError, getRequestURL } from 'h3';
import { enforceIpRateLimit, v1ApiLimit } from '~~/server/utils/v1ProxyPolicy';
import { proxyToBackend } from '~~/server/utils/backendProxy';
import { serverOnlyRoutes } from '~~/server/utils/generated/serverOnlyRoutes';
import { createPublicRouteMatcher } from '#shared/utils/backendSdk';

/**
 * Routes this proxy will not carry for a browser, whoever is asking.
 *
 * `proxyToBackend` stamps every request it forwards with the internal secret,
 * because that is how the backend recognises traffic that came through our own
 * frontend. A backend route that reads the same secret to mean "our own SERVER
 * is asking" -- the Shirabe credential, which hands out a live key for another
 * service -- cannot tell a Nitro-side call from a browser call this proxy
 * relayed. So those routes are refused here, before the stamp: the list is
 * generated from the spec's `x-server-only` markers, and the backend's own
 * agreement test keeps it matched to the controllers that check the secret.
 *
 * 403 rather than 404, deliberately: the route exists, and saying so is not a
 * leak -- it is in the internal spec -- while a 404 would send anyone debugging
 * a server-side call that lands here by mistake looking for a typo instead.
 */
const isServerOnlyRoute = createPublicRouteMatcher(serverOnlyRoutes);

export default defineEventHandler(async (event) => {
  await enforceIpRateLimit(event, v1ApiLimit);

  const { pathname } = getRequestURL(event);
  if (isServerOnlyRoute(event.node.req.method || 'GET', pathname)) {
    throw createError({
      statusCode: 403,
      statusMessage: 'This route is only callable by the Nadeshiko frontend server',
    });
  }

  return await proxyToBackend(event);
});
