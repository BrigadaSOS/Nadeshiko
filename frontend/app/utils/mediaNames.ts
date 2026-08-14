export type MediaNameLanguage = 'ENGLISH' | 'JAPANESE' | 'ROMAJI';

export type MediaNames = {
  nameEn?: string;
  nameJa?: string;
  nameRomaji?: string;
};

const ORDER: MediaNameLanguage[] = ['ENGLISH', 'JAPANESE', 'ROMAJI'];

/**
 * The names a title goes by other than the one already on screen.
 *
 * Deduplicated, which is the whole reason this is a function worth testing: a
 * title whose romaji and Japanese fields hold the same string -- extremely
 * common for titles already written in Latin script, `Death Note` among them --
 * rendered as "DEATH NOTE | DEATH NOTE" in the account's media tables. Compared
 * case-insensitively and after trimming, because the duplicates differ in case
 * as often as not, and the first spelling in `ORDER` is the one kept.
 *
 * The name in the reader's own language is excluded by language rather than by
 * value: it is displayed beside this, and dropping it by string match would also
 * drop a genuinely different title that happened to share its spelling.
 */
export function secondaryMediaNames(media: MediaNames, preferred: MediaNameLanguage): string[] {
  const byLanguage: Record<MediaNameLanguage, string> = {
    ENGLISH: media.nameEn || '',
    JAPANESE: media.nameJa || '',
    ROMAJI: media.nameRomaji || '',
  };

  const seen = new Set<string>();
  const names: string[] = [];

  for (const language of ORDER) {
    if (language === preferred) continue;

    const name = byLanguage[language].trim();
    if (!name) continue;

    const key = name.toLocaleLowerCase();
    if (seen.has(key)) continue;

    seen.add(key);
    names.push(name);
  }

  return names;
}
