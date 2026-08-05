import type { LocationQueryValue } from 'vue-router';

/** `null`/`undefined` drops the key from the URL rather than writing an empty value. */
export type QueryPatch = Record<string, LocationQueryValue | LocationQueryValue[] | undefined>;

/**
 * Patching the current `route.query` in place, for the filter and sort controls
 * that each own one query key and must leave the rest of the URL alone.
 *
 * Scrolling is opt-in per call: only the controls that replace the result list
 * below them jump the reader back to the top.
 */
export function useQuerySync() {
  const route = useRoute();
  const router = useRouter();

  /**
   * `'instant'` rather than `'smooth'`: the list underneath is being replaced at
   * the same time, and a smooth scroll lands the reader mid-flight in content
   * that has already changed under them.
   */
  const scrollToTop = () => {
    if (import.meta.client) {
      window.scrollTo({ top: 0, behavior: 'instant' });
    }
  };

  const setQuery = (patch: QueryPatch, options: { scroll?: boolean } = {}) => {
    const query = { ...route.query };

    for (const [key, value] of Object.entries(patch)) {
      if (value === null || value === undefined) {
        delete query[key];
      } else {
        query[key] = value;
      }
    }

    // Not awaited before scrolling: the jump belongs to the click, not to the
    // navigation settling. The promise is still returned for callers that care.
    const navigation = router.push({ path: route.path, query });
    if (options.scroll) scrollToTop();
    return navigation;
  };

  return { setQuery, scrollToTop };
}
