/**
 * The reader preferences that live in a cookie and are read during SSR.
 *
 * These names are the cache key for anonymous HTML, which is why they are
 * collected here instead of being spelled out wherever each one is used. Every
 * cookie in this list is read by `useCookiePreference` on the server pass, so it
 * changes what the render produces: measured on `/en/search/猫`, `nd_lang_prefs`
 * moves ~31KB of translations and `nd_hiragana` ~9KB of furigana in or out of the
 * page, and the other two flip a couple of attributes.
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
export const RENDER_FORKING_PREFERENCE_COOKIES = [
  'nd_lang_prefs',
  'nd_hiragana',
  'nd_tooltip_reading',
  'nd_dict_links',
] as const;

export type RenderForkingPreferenceCookie = (typeof RENDER_FORKING_PREFERENCE_COOKIES)[number];

/** Translation visibility per language (`useTranslationVisibility`). */
export const LANG_PREFS_COOKIE = 'nd_lang_prefs' satisfies RenderForkingPreferenceCookie;
/** Furigana show / spoiler / hidden (`useHiraganaVisibility`). */
export const HIRAGANA_COOKIE = 'nd_hiragana' satisfies RenderForkingPreferenceCookie;
/** Which reading the token tooltip shows (`useTooltipReadingVisibility`). */
export const TOOLTIP_READING_COOKIE = 'nd_tooltip_reading' satisfies RenderForkingPreferenceCookie;
/** Which dictionaries the word card links out to (`useDictionaryLinks`). */
export const DICT_LINKS_COOKIE = 'nd_dict_links' satisfies RenderForkingPreferenceCookie;
