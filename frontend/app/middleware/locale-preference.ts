import { useLocalePreference } from '~/composables/useLocalePreference';
import { splitLocalePrefix } from '~/utils/routes';

/**
 * Localises a locale-agnostic path (`/user/settings`) for the current reader:
 * their stored locale preference when they have one, otherwise whichever locale
 * they are already browsing in.
 */
export function preferredLocalePath(path: string): string {
  const localePath = useLocalePath();
  const { preferredLocale } = useLocalePreference();
  return (preferredLocale.value && localePath(path, preferredLocale.value)) || localePath(path);
}

/**
 * Keeps a reader who picked a UI locale on that locale's URLs even when they
 * arrive on a different prefix. Opted into per page rather than registered
 * globally: only the account area follows the preference this way.
 */
export default defineNuxtRouteMiddleware((to) => {
  const { preferredLocale } = useLocalePreference();
  if (!preferredLocale.value) return;

  const { localizedPath } = splitLocalePrefix(to.path);
  const preferredPath = preferredLocalePath(localizedPath);
  if (preferredPath && preferredPath !== to.path) {
    return navigateTo({ path: preferredPath, query: to.query, hash: to.hash }, { replace: true });
  }
});
