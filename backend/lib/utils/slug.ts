export function slugify(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100);
}

const JAPANESE_RE = /[　-〿぀-ゟ゠-ヿ一-龯＀-ﾟ]/;

export function hasJapaneseChars(text: string): boolean {
  return JAPANESE_RE.test(text);
}

/** Last resort when nothing a media carries survives slugify. */
export const FALLBACK_SLUG = 'media';

/**
 * The text a media's slug is built from.
 *
 * Prefers the romaji name, then the English one, as before. slugify() drops every
 * non-ASCII character, so a Japanese-only name (e.g. a YouTube channel whose romaji
 * and English names are both its Japanese title) would yield an empty slug, and an
 * empty slug breaks media listing. Each candidate is therefore taken only if it still
 * slugifies to something; `fallbacks` (external IDs, the public ID) come after the
 * names, and FALLBACK_SLUG after everything.
 */
export function pickSlugSource(
  nameRomaji: string | null | undefined,
  nameEn: string | null | undefined,
  fallbacks: ReadonlyArray<string | null | undefined> = [],
): string {
  const romaji = nameRomaji ?? '';
  const candidates = [
    hasJapaneseChars(romaji) ? '' : romaji,
    nameEn ?? '',
    romaji, // a mixed romaji/Japanese name still has usable ASCII
    ...fallbacks.map((value) => value ?? ''),
  ];
  return candidates.find((candidate) => slugify(candidate) !== '') ?? FALLBACK_SLUG;
}
