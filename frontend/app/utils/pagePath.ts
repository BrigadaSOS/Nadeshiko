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
    for (const [pattern, replacement] of DYNAMIC_ROUTE_PATTERNS) {
      if (pattern.test(path)) return replacement;
    }
    return path;
  } catch {
    return '/';
  }
}
