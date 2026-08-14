/**
 * "Is this route the shared corpus?" — asked of the generated allowlist.
 *
 * A parallel copy of the frontend's `createPublicRouteMatcher`
 * (`frontend/shared/utils/backendSdk.ts`), for the same reason `lib/traffic.ts`
 * duplicates `shared/utils/traffic.ts`: the two packages have separate builds
 * and neither can import from the other. What must not drift is the ROUTE LIST,
 * and that does not -- both sides are emitted from one pass of
 * `bin/generatePublicRoutes.ts`, so a route can never be public on one side and
 * private on the other.
 */
import { publicApiRoutes, type PublicApiRoute } from 'generated/publicApiRoutes';

/** Turns an OpenAPI path template (`/v1/media/{id}`) into a matcher for a real path. */
function toPathMatcher(openApiPath: string): RegExp {
  const pattern = openApiPath
    .split('/')
    .map((segment) =>
      segment.startsWith('{') && segment.endsWith('}') ? '[^/]+' : segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
    )
    .join('/');
  return new RegExp(`^${pattern}$`);
}

export function createPublicRouteMatcher(routes: readonly PublicApiRoute[]) {
  const compiled = routes.map((route) => ({ method: route.method.toUpperCase(), matcher: toPathMatcher(route.path) }));

  return (method: string, pathname: string): boolean => {
    const normalized = method.toUpperCase();
    return compiled.some((route) => route.method === normalized && route.matcher.test(pathname));
  };
}

/**
 * Whether `method pathname` reads the shared corpus.
 *
 * Compiled once at module load: the list is a build artifact, so rebuilding the
 * regexes per request would be pure waste on the hot path.
 */
export const isPublicApiRoute = createPublicRouteMatcher(publicApiRoutes);
