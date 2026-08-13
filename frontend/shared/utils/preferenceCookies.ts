/**
 * The reader preferences that live in a cookie and are read during SSR.
 *
 * These names are the cache key for anonymous HTML, which is why they are
 * collected here instead of being spelled out wherever each one is used. Every
 * cookie in this list is read by `useCookiePreference` on the server pass, so it
 * changes what the render produces: measured on `/en/search/猫`, `nd_lang_prefs`
 * moves ~31KB of translations and `nd_hiragana` ~9KB of furigana in or out of the
 * page, and `nd_dict_links` flips a couple of attributes.
 *
 * **Adding a `useCookiePreference` cookie means adding it here.** A shared cache
 * that does not know about a cookie will happily store one reader's copy and
 * serve it to everyone -- one visitor turning furigana off would turn it off for
 * every anonymous reader hitting the same edge node. This list is what
 * `visitorCacheTier` uses to decide whether a request may be served a shared
 * copy at all, and the failure is silent, so the list has to be exhaustive.
 *
 * Not included, deliberately: `nd-locale-preference`. It only picks the
 * destination of the `/` redirect (see `resolveRootLocale`); the rendered locale
 * lives in the URL path, so it is already part of every cache key. Verified: the
 * same page with and without that cookie renders byte-identically.
 */
export const RENDER_FORKING_PREFERENCE_COOKIES = ['nd_lang_prefs', 'nd_hiragana', 'nd_dict_links'] as const;

export type RenderForkingPreferenceCookie = (typeof RENDER_FORKING_PREFERENCE_COOKIES)[number];

/** Translation visibility per language (`useTranslationVisibility`). */
export const LANG_PREFS_COOKIE = 'nd_lang_prefs' satisfies RenderForkingPreferenceCookie;
/** Furigana show / spoiler / hidden (`useHiraganaVisibility`). */
export const HIRAGANA_COOKIE = 'nd_hiragana' satisfies RenderForkingPreferenceCookie;
/** Which dictionaries the word card links out to (`useDictionaryLinks`). */
export const DICT_LINKS_COOKIE = 'nd_dict_links' satisfies RenderForkingPreferenceCookie;

/**
 * Preferences that no longer exist, whose cookies readers still carry.
 *
 * A retired name is not free to forget. It rides along on every request for a
 * year after its last write, and a future preference that reuses the name would
 * parse a value written by a feature that meant something else. Listing it here
 * both reserves the name and tells `plugins/retiredCookies.client.ts` what to
 * clear, so the fleet drains instead of waiting out the expiry.
 *
 * `nd_tooltip_reading` -- the token popup used to render its reading in
 * katakana, romaji, or not at all. Removed: furigana visibility (`nd_hiragana`)
 * is the setting readers actually reach for, and the popup's own copy of the
 * idea mostly served to hide the pitch-accent diagram without saying so.
 *
 * Removing an entry from this list once it has shipped is safe only after the
 * cookie's one-year max-age has run out for everyone who still had it.
 */
export const RETIRED_PREFERENCE_COOKIES = ['nd_tooltip_reading'] as const;
