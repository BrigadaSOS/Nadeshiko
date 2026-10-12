import { serverOnlyRoutes } from './generated/serverOnlyRoutes';
import { createPublicRouteMatcher } from '#shared/utils/backendSdk';

// Match Express's case-insensitive, optional-trailing-slash and HEAD-to-GET routing before adding the internal secret.
// Keep normalization separate from the public allowlist: widening that matcher grants privileges.
function normalizeExpressPath(pathname: string): string {
  const withoutTrailingSlashes = pathname.replace(/\/+$/, '');
  return (withoutTrailingSlashes || '/').toLowerCase();
}

const matchesServerOnlyRoute = createPublicRouteMatcher(
  serverOnlyRoutes.map((route) => ({ ...route, path: normalizeExpressPath(route.path) })),
);

export function isServerOnlyProxyRoute(method: string, pathname: string): boolean {
  // Express's GET routes answer HEAD unless a dedicated HEAD route exists.
  const expressMethod = method.toUpperCase() === 'HEAD' ? 'GET' : method;
  return matchesServerOnlyRoute(expressMethod, normalizeExpressPath(pathname));
}
