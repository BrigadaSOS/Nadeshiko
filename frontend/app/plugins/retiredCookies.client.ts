import { RETIRED_PREFERENCE_COOKIES } from '#shared/utils/preferenceCookies';
import { PREFERENCE_COOKIE_OPTIONS } from '~/composables/useCookiePreference';

/**
 * Delete retired preferences client-side so shared-cache HTML does not acquire per-visitor Set-Cookie
 * headers.
 */
export default defineNuxtPlugin(() => {
  for (const name of RETIRED_PREFERENCE_COOKIES) {
    // Anchored so a cookie merely ENDING in this name is not mistaken for it:
    // cookies are `; `-separated, so a name can only start a pair or the string.
    if (!new RegExp(`(^|;\\s*)${name}=`).test(document.cookie)) continue;

    // Delete with the original path/domain options; cookies with different scope are distinct. Nuxt's null
    // value expires the cookie.
    useCookie(name, PREFERENCE_COOKIE_OPTIONS).value = null;
  }
});
