import { splitLocalePrefix, withLocalePrefix } from '~/utils/routes';

const DYNAMIC_ROUTE_PATTERNS: [RegExp, string][] = [
  [/^\/search\/.*/, '/search/:query'],
  [/^\/sentence\/.*/, '/sentence/:id'],
  [/^\/collection\/.*/, '/collection/:id'],
  [/^\/s\/.*/, '/s/:id'],
  [/^\/admin\/.*/, '/admin/:slug'],
  [/^\/settings\/.*/, '/settings/:slug'],
  [/^\/user\/.*/, '/user/:slug'],
];

export function getPagePath(): string {
  try {
    const path = new URL(window.location.href).pathname;
    const { localePrefix, localizedPath } = splitLocalePrefix(path);
    for (const [pattern, replacement] of DYNAMIC_ROUTE_PATTERNS) {
      if (pattern.test(localizedPath)) return withLocalePrefix(localePrefix, replacement);
    }
    return path;
  } catch {
    return '/';
  }
}
