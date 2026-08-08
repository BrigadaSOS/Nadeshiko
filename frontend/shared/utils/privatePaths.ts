/**
 * Path segments that belong to one reader rather than to the public corpus.
 *
 * One list, three consumers, because they were three lists and had already
 * drifted apart: `robots.disallow` named settings and reports, the `robots: false`
 * route rules did not, and neither knew about collections — which the cache tier
 * excluded on its own. Each of those is a different kind of quiet failure (a
 * crawler indexing an account screen, a shared cache holding one), and none of
 * them announces itself.
 *
 * Written without a locale prefix. Every consumer applies it across all locales,
 * which is also what stopped the hand-written `robots` list from being checkable:
 * four segments times three locales times a trailing-slash variant is twenty-odd
 * lines nobody re-reads.
 *
 * `/collection` is here for the reason the others are, plus one: the backend
 * requires authentication to read ANY collection, public ones included, so a
 * crawler can only ever receive the redirect. There is nothing to index and
 * nothing safe to share.
 */
export const PRIVATE_PATH_SEGMENTS = ['/user', '/admin', '/settings', '/reports', '/collection'] as const;

/**
 * Whether a path is one of the private areas, with or without a locale prefix.
 *
 * Segment-aware on purpose: `/en/users-guide` is not `/en/user`, and a plain
 * `startsWith` would have quietly excluded it from the cache and the index
 * forever.
 */
export function isPrivatePath(path: string): boolean {
  const withoutLocale = path.replace(/^\/(en|es|ja)(?=\/|$)/, '') || '/';
  return PRIVATE_PATH_SEGMENTS.some((segment) => withoutLocale === segment || withoutLocale.startsWith(`${segment}/`));
}
