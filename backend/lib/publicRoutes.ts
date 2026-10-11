/** Keep the backend matcher as a generated parallel of the frontend matcher; separate builds require copies, but one
 * generator pass must keep the route list identical. */
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

/** Compile the generated public-route regexes once at module load rather than rebuilding them on every request. */
export const isPublicApiRoute = createPublicRouteMatcher(publicApiRoutes);
