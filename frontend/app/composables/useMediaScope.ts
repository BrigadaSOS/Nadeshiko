import { buildMediaPath, splitLocalePrefix } from '~/utils/routes';

/**
 * Where a change to the "which title am I looking at" filter should land.
 *
 * There are now two URLs that can hold that scope, and they hold it in different
 * places: `/search/<word>?media=<id>` carries it in the query because the word is
 * the subject and the title is a filter on it, while `/media/<slug>` carries it
 * in the path because the title IS the subject. Patching `?media=` works for the
 * first and is meaningless for the second -- `SearchContainer` reads the path
 * there, so the patch would change the URL without changing the page.
 *
 * So the decision is made once, here, rather than at each of the four filter
 * controls that used to call `setQuery({ media })` directly and would each have
 * needed the same three branches.
 */
export function useMediaScope() {
  const route = useRoute();
  const router = useRouter();
  const localePath = useLocalePath();
  const { setQuery, scrollToTop } = useQuerySync();

  /** True on `/media/<slug>`, where the title is the path. Not on `/media` itself. */
  const isMediaPage = computed(() => {
    const { localizedPath } = splitLocalePrefix(route.path);
    return localizedPath.startsWith('/media/');
  });

  /** The word being searched, if any. A title browse has none. */
  const hasSearchWord = computed(() => Boolean(route.params.query));

  /**
   * Point the view at a title, or at everything when `publicId` is null.
   *
   * `slug` is what makes the readable URL possible; when it is missing -- an
   * older payload, a title still being imported -- this falls back to the query
   * form, which always works. A filter click must never dead-end because a slug
   * was absent.
   */
  const selectMedia = (publicId: string | null, slug?: string | null) => {
    // Switching or clearing a title drops the episode with it: episode numbers
    // do not carry across titles, so the old one filters the new list to nothing.
    if (publicId === null) {
      if (isMediaPage.value) {
        // The scope is the path here, so it cannot be cleared by patching the
        // query -- back out to the search page, keeping how the reader was
        // looking (category, sort) but not what they were looking at.
        const query = { ...route.query };
        delete query.media;
        delete query.episode;
        void router.push({ path: localePath('/search'), query });
        scrollToTop();
        return;
      }
      setQuery({ media: null, episode: null }, { scroll: true });
      return;
    }

    // A search is in progress: the word stays the subject and the title stays a
    // filter on it, exactly as before.
    if (hasSearchWord.value || !slug) {
      setQuery({ media: publicId, episode: null }, { scroll: true });
      return;
    }

    // Browsing: the title becomes the subject, so it gets its own indexable URL.
    void router.push({ path: localePath(buildMediaPath(slug)) });
    scrollToTop();
  };

  return { isMediaPage, selectMedia };
}
