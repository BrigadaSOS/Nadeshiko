import { serverOnlyRoutes } from './generated/serverOnlyRoutes';
import { createPublicRouteMatcher } from '#shared/utils/backendSdk';

/**
 * Makes the denylist agree with Express's default routing behaviour.
 *
 * Express is case-insensitive and accepts an optional trailing slash unless an
 * application explicitly enables its `case sensitive routing` and `strict
 * routing` settings. It also dispatches HEAD to a GET handler when there is no
 * explicit HEAD handler. The backend uses those defaults, so the Nitro edge has
 * to refuse the same spellings before it adds the internal proxy secret.
 *
 * This is deliberately separate from `createPublicRouteMatcher`: that matcher
 * decides when SSR may attach the service key, where accepting an extra spelling
 * would be a privilege expansion rather than a denial.
 */
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
