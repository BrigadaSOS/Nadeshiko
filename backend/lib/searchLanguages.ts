/** Normalize both accepted `languages` shapes and casing here so query construction, highlights, polarity, and cache
 * keys cannot drift. */

const SEARCH_LANGUAGES = ['EN', 'ES'] as const;

export type SearchLanguage = (typeof SEARCH_LANGUAGES)[number];

type LanguagesFilter = readonly string[] | { readonly exclude?: readonly string[] } | null | undefined;

/** Translation languages to match alongside Japanese. Omitted filter means all of them. */
export function includedSearchLanguages(languages: LanguagesFilter): SearchLanguage[] {
  if (languages == null) return [...SEARCH_LANGUAGES];
  if (Array.isArray(languages)) return toSearchLanguages(languages);

  const excluded = new Set(toSearchLanguages((languages as { exclude?: readonly string[] }).exclude));
  return SEARCH_LANGUAGES.filter((language) => !excluded.has(language));
}

/** Translation languages to keep out of both matching and highlighting. */
export function excludedSearchLanguages(languages: LanguagesFilter): SearchLanguage[] {
  if (languages == null) return [];

  const included = new Set(includedSearchLanguages(languages));
  return SEARCH_LANGUAGES.filter((language) => !included.has(language));
}

function toSearchLanguages(values: readonly string[] | undefined): SearchLanguage[] {
  if (!values) return [];

  const normalized = new Set(values.map((value) => String(value).toUpperCase()));
  return SEARCH_LANGUAGES.filter((language) => normalized.has(language));
}
