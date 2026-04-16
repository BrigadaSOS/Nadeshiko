type MediaNameLanguage = 'ENGLISH' | 'JAPANESE' | 'ROMAJI';

type HasMediaNames = {
  nameEn: string;
  nameJa: string;
  nameRomaji: string;
};

const localeToLanguage: Record<string, MediaNameLanguage> = {
  ja: 'JAPANESE',
  en: 'ENGLISH',
  es: 'ENGLISH',
};

export function useMediaName() {
  const { locale } = useI18n();
  const store = userStore();

  const language = computed<MediaNameLanguage>(() => {
    if (store.isLoggedIn && store.preferences?.mediaNameLanguage) {
      return store.preferences.mediaNameLanguage as MediaNameLanguage;
    }
    return localeToLanguage[locale.value] ?? 'ENGLISH';
  });

  const mediaName = (media: HasMediaNames): string => {
    switch (language.value) {
      case 'JAPANESE':
        return media.nameJa || media.nameEn;
      case 'ROMAJI':
        return media.nameRomaji || media.nameEn;
      default:
        return media.nameEn;
    }
  };

  return { mediaName, language };
}
