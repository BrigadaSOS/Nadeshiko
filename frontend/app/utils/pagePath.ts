import { splitLocalePrefix, withLocalePrefix } from '~/utils/routes';

const DYNAMIC_ROUTE_PATTERNS: [RegExp, string][] = [
  [/^\/search\/.*/, '/search/:query'],
  // Added 2026-08-23 for the RUM reporter, which turns this into a Prometheus
  // label: 242 media slugs across three locales is 726 series per vital per
  // bucket, and the blog is unbounded over time.
  [/^\/media\/.+/, '/media/:slug'],
  [/^\/blog\/.+/, '/blog/:slug'],
  [/^\/sentence\/.*/, '/sentence/:id'],
  [/^\/collection\/.*/, '/collection/:id'],
  [/^\/s\/.*/, '/s/:id'],
  [/^\/admin\/.*/, '/admin/:slug'],
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
