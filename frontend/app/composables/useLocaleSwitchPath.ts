import { canonicalPath, queryAndHash, splitLocalePrefix, withLocalePrefix } from '~/utils/routes';

/**
 * Use canonicalPath to avoid router-driven double-encoding of search paths. Unlike canonical
 * links, language-switch links are relative and retain the whole query and hash, including sort
 * and cursor.
 */
export function useLocaleSwitchPath() {
  const route = useRoute();

  return (localeCode: string): string => {
    // Never `route.path`; see the plugin comment and `canonicalPath`.
    const path = canonicalPath(route.path, route.params.query as string | string[] | undefined);
    const { localizedPath } = splitLocalePrefix(path);

    return `${withLocalePrefix(`/${localeCode}`, localizedPath)}${queryAndHash(route.fullPath)}`;
  };
}
