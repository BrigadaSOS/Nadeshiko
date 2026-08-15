export type TranslationLanguage = 'EN' | 'ES';
export type GlossLanguage = Lowercase<TranslationLanguage>;

const DEFAULT_TRANSLATION_LANGUAGES: readonly TranslationLanguage[] = ['EN', 'ES'];

/** The useful default before a reader makes an explicit global choice. */
export function defaultTranslationLanguages(locale: string): TranslationLanguage[] {
  if (locale === 'en') return ['EN'];
  if (locale === 'es') return ['ES'];
  return [...DEFAULT_TRANSLATION_LANGUAGES];
}

/**
 * The global dictionary-language choice. Search's visibility menu deliberately
 * remains separate: it is a local rendering override, not a declaration that a
 * language is useful everywhere else.
 */
export function normalizeTranslationLanguages(raw: unknown, locale: string): TranslationLanguage[] {
  if (!Array.isArray(raw)) return defaultTranslationLanguages(locale);

  const languages = raw.filter((language): language is TranslationLanguage => language === 'EN' || language === 'ES');
  const unique = [...new Set(languages)];
  return unique.length > 0 ? unique : defaultTranslationLanguages(locale);
}

export function useTranslationLanguages() {
  const user = userStore();
  const { locale } = useI18n();

  const languages = computed(() => normalizeTranslationLanguages(user.preferences?.translationLanguages, locale.value));
  const glossLanguages = computed<GlossLanguage[]>(() =>
    languages.value.map((language) => language.toLowerCase() as GlossLanguage),
  );

  return { languages, glossLanguages };
}
