export const LOCALE_PREFERENCE_COOKIE_NAME = 'nd-locale-preference';
export const SUPPORTED_LOCALES = ['en', 'es', 'ja', 'zh', 'id', 'pt-BR'] as const;

export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

/** Public route code -> standards-based language tag for document metadata. */
export const LOCALE_LANGUAGE_TAGS: Record<SupportedLocale, string> = {
  en: 'en',
  es: 'es',
  ja: 'ja',
  zh: 'zh-Hans',
  id: 'id',
  'pt-BR': 'pt-BR',
};

/**
 * The locales that are allowed into a search index -- a subset of the ones the
 * app can actually render.
 *
 * `ja` ships as a UI language but is deliberately kept out of the index:
 * `robots` disallows it and `/ja/**` carries `robots: false`, because the
 * Japanese copy of a page about Japanese sentences competes with the English and
 * Spanish ones for the same corpus without adding a reader.
 *
 * This exists so that decision is stated in ONE place. It was previously spelled
 * out twice -- as a literal in `nuxt.config.ts` for robots, and implicitly in
 * `plugins/canonical.ts`, which built hreflang alternates from SUPPORTED_LOCALES
 * and so advertised `/ja` URLs as indexable alternates of pages whose own
 * `robots` header said the opposite. Search engines resolve that contradiction
 * by distrusting the whole alternate set.
 *
 * `nuxt.config.ts` imports this directly (it is a plain constant module with no
 * Nuxt runtime imports, so it evaluates fine in the config's Node context).
 */
export const INDEXED_LOCALES = ['en', 'es', 'zh', 'id', 'pt-BR'] as const satisfies readonly SupportedLocale[];

export type IndexedLocale = (typeof INDEXED_LOCALES)[number];
