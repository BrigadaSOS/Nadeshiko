import { RETIRED_PREFERENCE_COOKIES } from '#shared/utils/preferenceCookies';
import { PREFERENCE_COOKIE_OPTIONS } from '~/composables/useCookiePreference';

/**
 * Clears the cookies of preferences that have been removed.
 *
 * A retired preference stops being read the moment its code goes, but the cookie
 * itself lives for the rest of its year: it is sent on every request, shows up
 * in devtools as a setting the site appears to still have, and reserves a name a
 * future preference might want back.
 *
 * Deliberately the client and not a server `Set-Cookie`. These names are no
 * longer in `RENDER_FORKING_PREFERENCE_COOKIES`, so a visitor carrying one is
 * already back in the `shared` cache tier (see `server/utils/visitorCacheTier`)
 * -- and attaching a `Set-Cookie` to their HTML would take that away again,
 * both by making the response one a shared cache must not store and by putting a
 * per-visitor header on the very pages that are meant to be byte-identical for
 * everyone. Deleting from the browser reaches the same end state and touches no
 * response.
 *
 * The ordinary case -- a reader who never set one -- is a string search over
 * `document.cookie` and nothing else.
 */
export default defineNuxtPlugin(() => {
  for (const name of RETIRED_PREFERENCE_COOKIES) {
    // Anchored so a cookie merely ENDING in this name is not mistaken for it:
    // cookies are `; `-separated, so a name can only start a pair or the string.
    if (!new RegExp(`(^|;\\s*)${name}=`).test(document.cookie)) continue;

    // The options that wrote it, because a cookie is replaced by name, path and
    // domain -- deleting with a different path leaves the original in place and
    // silently does nothing. `null` is Nuxt's delete: it serializes the write as
    // `Max-Age=-1`, and an already-expired cookie is dropped rather than stored.
    useCookie(name, PREFERENCE_COOKIE_OPTIONS).value = null;
  }
});
