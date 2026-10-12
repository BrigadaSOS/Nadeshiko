import { splitLocalePrefix } from '~/utils/routes';

/**
 * The All action from a title page changes filter scope, not list position; suppress Nuxt's path-change
 * scroll reset.
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
