import { splitLocalePrefix } from '~/utils/routes';

/**
 * All from `/media/<slug>` is a filter change that happens to change the path.
 * Nuxt's default scrollBehavior treats any path change as "new page, go to top",
 * which yanks the list out from under the click.
 */
export default defineNuxtPlugin(() => {
  const router = useRouter();
  const original = router.options.scrollBehavior;

  router.options.scrollBehavior = (to, from, savedPosition) => {
    const fromPath = splitLocalePrefix(from.path).localizedPath;
    const toPath = splitLocalePrefix(to.path).localizedPath;
    if (fromPath.startsWith('/media/') && (toPath === '/search' || toPath === '/search/')) {
      return false;
    }
    return original?.(to, from, savedPosition);
  };
});
