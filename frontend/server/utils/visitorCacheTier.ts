import { getCookie } from 'h3';
import type { H3Event } from 'h3';
import { RENDER_FORKING_PREFERENCE_COOKIES } from '#shared/utils/preferenceCookies';
import { isPrivatePath } from '#shared/utils/privatePaths';
import { hasSessionCookie } from './ssrAuthCache';

// shared: URL-only content, apart from per-render tokens. browser: anonymous preferences fork the markup.
// personal: session-dependent markup. Classify from the request before rendering; nonempty default-valued
// preference cookies conservatively miss the shared cache.
export type VisitorCacheTier = 'shared' | 'browser' | 'personal';

const PREFERENCE_COOKIES: readonly string[] = RENDER_FORKING_PREFERENCE_COOKIES;

// Private areas remain non-shareable even for cookie-less requests; robots and route rules use the same list.
export const htmlPathIsShareable = (path: string): boolean => !isPrivatePath(path);

export function visitorCacheTier(event: H3Event): VisitorCacheTier {
  // Session identity takes precedence over preferences.
  if (hasSessionCookie(event)) return 'personal';

  for (const name of PREFERENCE_COOKIES) {
    // An empty preference value means the default and renders like no cookie.
    if (getCookie(event, name)) return 'browser';
  }

  return 'shared';
}
