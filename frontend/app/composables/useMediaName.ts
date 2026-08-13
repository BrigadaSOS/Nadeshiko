import { firstNonBlank } from '~/utils/strings';

type MediaNameLanguage = 'ENGLISH' | 'JAPANESE' | 'ROMAJI';

type HasMediaNames = {
  nameEn: string;
  nameJa: string;
  nameRomaji: string;
};

const localeToLanguage: Record<string, MediaNameLanguage> = {
  ja: 'JAPANESE',
  en: 'ENGLISH',
  es: 'ROMAJI',
};

export function useMediaName() {
  const { locale } = useI18n();
  const store = userStore();

  const language = computed<MediaNameLanguage>(() => {
    // Preferences are loaded during SSR too (see plugins/identity-auth.ts), so
    // gating this on the client would render every name twice: once from the
    // locale, then again from the preference on hydration.
    if (store.isLoggedIn && store.preferences?.mediaNameLanguage) {
      return store.preferences.mediaNameLanguage as MediaNameLanguage;
    }
    return localeToLanguage[locale.value] ?? 'ENGLISH';
  });

  /**
   * Every branch falls through all three names rather than stopping at the
   * preferred one. Not every media row carries a romaji or English title, and the
   * preference is about which name a reader would rather see -- not a claim that
   * it exists. Returning `''` because the preferred field is empty renders a
   * nameless card, and shipping that `''` to the activity API stored an empty
   * name that later failed response validation for the whole timeline.
   */
  const mediaName = (media: HasMediaNames): string => {
    switch (language.value) {
      case 'JAPANESE':
        return firstNonBlank(media.nameJa, media.nameEn, media.nameRomaji) ?? '';
      case 'ROMAJI':
        return firstNonBlank(media.nameRomaji, media.nameEn, media.nameJa) ?? '';
      default:
        return firstNonBlank(media.nameEn, media.nameRomaji, media.nameJa) ?? '';
    }
  };

  return { mediaName, language };
}
