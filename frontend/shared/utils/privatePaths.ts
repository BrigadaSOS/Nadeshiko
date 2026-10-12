// Locale-independent private areas shared by cache eligibility, robots and route rules. Collections require
// authentication even when public, so they offer crawlers neither indexable content nor a shareable response.
export const PRIVATE_PATH_SEGMENTS = ['/user', '/admin', '/settings', '/reports', '/collection'] as const;

// Match segment boundaries: /en/users-guide is not the private /en/user area.
export function isPrivatePath(path: string): boolean {
  const withoutLocale = path.replace(/^\/(en|es|ja|zh|zh-hant|id|pt-BR)(?=\/|$)/, '') || '/';
  return PRIVATE_PATH_SEGMENTS.some((segment) => withoutLocale === segment || withoutLocale.startsWith(`${segment}/`));
}
