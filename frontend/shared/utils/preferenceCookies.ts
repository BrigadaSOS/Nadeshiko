// Every SSR useCookiePreference cookie must appear here so shared caches never serve one reader
// another reader's preferences. nd-locale-preference is excluded: it selects redirects, while page locale is in the URL.
export const RENDER_FORKING_PREFERENCE_COOKIES = [
  'nd_lang_prefs',
  'nd_hiragana',
  'nd_dict_links',
  'nd-motion',
] as const;

export type RenderForkingPreferenceCookie = (typeof RENDER_FORKING_PREFERENCE_COOKIES)[number];

export const LANG_PREFS_COOKIE = 'nd_lang_prefs' satisfies RenderForkingPreferenceCookie;

export const HIRAGANA_COOKIE = 'nd_hiragana' satisfies RenderForkingPreferenceCookie;

export const DICT_LINKS_COOKIE = 'nd_dict_links' satisfies RenderForkingPreferenceCookie;
// SSR stamps data-motion. Preserve the hyphenated cookie name so existing preferences are not orphaned.
export const MOTION_COOKIE = 'nd-motion' satisfies RenderForkingPreferenceCookie;

// Reserve retired names and clear their cookies. Remove entries only after the one-year max-age has elapsed
// for all readers, or a reused name could parse values from an unrelated retired feature.
export const RETIRED_PREFERENCE_COOKIES = ['nd_tooltip_reading'] as const;
