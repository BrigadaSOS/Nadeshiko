import { canonicalPath, queryAndHash, splitLocalePrefix, withLocalePrefix } from '~/utils/routes';

/**
 * Where the language switcher should send the reader, for a given locale.
 *
 * A replacement for `useSwitchLocalePath()`, and the reason is the same one that
 * took the canonical and the hreflang alternates off the i18n module: the module
 * builds its hrefs from the router's idea of the current path, which on a search
 * page is percent-encoded one layer deeper than the URL that was requested. See
 * `canonicalPath` for the mechanism.
 *
 * `app.vue` already drops every link `useLocaleHead()` emits, and
 * `plugins/canonical.ts` re-emits corrected ones. What neither covers is this
 * switcher, because its links are in the BODY rather than the head -- and a
 * crawler follows those just as readily. Fetching an over-escaped search URL on
 * production returned 200 and three of these, one per locale, each a layer deeper
 * than the page they were on.
 *
 * Two deliberate differences from `plugins/canonical.ts`, which is otherwise
 * doing the same job:
 *
 * - **The whole query survives, not the canonical subset.** A canonical URL drops
 *   `sort` and `cursor` on purpose, because they name the same set of results. A
 *   reader switching language mid-search must keep them: they are standing
 *   somewhere, and the switcher's job is to put them in the same place in another
 *   language.
 * - **Relative, not absolute.** These are in-app links, not statements to a search
 *   engine about which URL is authoritative.
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
