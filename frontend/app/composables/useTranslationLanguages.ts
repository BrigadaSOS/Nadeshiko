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

  /**
   * Which languages a DEFINITION is worth showing in, which is no longer the
   * same question as the one above once a reader links a Shirabe account.
   *
   * Two places were answering it. A reader who put `jmdict:es` above
   * `jmdict:en` in their Shirabe stack has said "Spanish definitions first", on
   * the site that owns their dictionaries -- and the word card went on asking
   * the Nadeshiko dropdown, which might say the opposite. Shirabe wins, because
   * that is where the dictionaries are configured.
   *
   * The setting is NOT redundant and must not be disabled with it: the same
   * value decides which subtitle translation rows render under every sentence,
   * which EN/ES toggles the search toolbar offers, and which translations the
   * segment menu can copy. Shirabe has no opinion about any of those. So the
   * split is here, at the one question a linked account really does answer.
   *
   * Falls back to the reader's own setting when the stack names no gloss
   * language -- a stack of nothing but personal `:ja` monolinguals says nothing
   * about English or Spanish.
   */
  const dictionaryGlossLanguages = computed<GlossLanguage[]>(() => {
    const stacked = (user.shirabeGlossLanguages ?? []).filter(
      (language): language is GlossLanguage => language === 'en' || language === 'es',
    );
    return stacked.length > 0 ? [...new Set(stacked)] : glossLanguages.value;
  });

  return { languages, glossLanguages, dictionaryGlossLanguages };
}
