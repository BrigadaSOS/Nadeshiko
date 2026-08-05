import { SUPPORTED_LOCALES } from '~/utils/i18n';

// Derived, never hand-listed: adding a locale to SUPPORTED_LOCALES has to be
// enough, or splitLocalePrefix silently stops recognising the new prefix and
// every caller (search-redirect, canonical, pagePath) treats it as a page path.
const LOCALE_PREFIXES = SUPPORTED_LOCALES.map((locale) => `/${locale}`);

export function splitLocalePrefix(path: string): { localePrefix: string; localizedPath: string } {
  const localePrefix = LOCALE_PREFIXES.find((prefix) => path === prefix || path.startsWith(`${prefix}/`)) ?? '';
  const localizedPath = localePrefix ? path.slice(localePrefix.length) || '/' : path;
  return { localePrefix, localizedPath };
}

export function withLocalePrefix(localePrefix: string, path: string): string {
  if (!localePrefix) return path;
  return path === '/' ? localePrefix : `${localePrefix}${path}`;
}

export function buildWordSearchPath(word: string): string {
  return `/search/${encodeURIComponent(word)}`;
}

export function buildMediaSearchPath(mediaPublicId: string, episode?: number | string | null): string {
  const params = new URLSearchParams({ media: mediaPublicId });
  if (episode !== undefined && episode !== null && `${episode}` !== '') {
    params.set('episode', `${episode}`);
  }
  return `/search?${params.toString()}`;
}

export function buildSentencePath(segmentPublicId: string): string {
  return `/sentence/${segmentPublicId}`;
}

/**
 * A single string from a route query value, or null when it is absent or empty.
 *
 * Vue Router types a query value as `string | string[] | null`, and both the
 * search page and the search container had their own copy of this narrowing --
 * one typed against `LocationQueryValue`, the other against plain strings.
 * An empty string is treated as absent: `?media=` means no filter, not a filter
 * matching the empty id. The parameter type mirrors Vue Router's `LocationQueryValue`
 * (`string | null`), so both callers pass their route query straight through.
 */
export function getStringQueryValue(
  value: string | null | undefined | ReadonlyArray<string | null | undefined>,
): string | null {
  const first = Array.isArray(value) ? value[0] : value;
  if (first === undefined || first === null || first === '') {
    return null;
  }
  return String(first);
}
