import { useLocalePreference } from '~/composables/useLocalePreference';
import { splitLocalePrefix } from '~/utils/routes';

/** Localize an unprefixed path with the stored preference, falling back to the current browsing locale. */
export function preferredLocalePath(path: string): string {
  const localePath = useLocalePath();
  const { preferredLocale } = useLocalePreference();
  return (preferredLocale.value && localePath(path, preferredLocale.value)) || localePath(path);
}

/** Follow the stored locale only on opted-in account pages, not globally. */
export default defineNuxtRouteMiddleware((to) => {
  const { preferredLocale } = useLocalePreference();
  if (!preferredLocale.value) return;

  const { localizedPath } = splitLocalePrefix(to.path);
  const preferredPath = preferredLocalePath(localizedPath);
  if (preferredPath && preferredPath !== to.path) {
    return navigateTo({ path: preferredPath, query: to.query, hash: to.hash }, { replace: true });
  }
});
