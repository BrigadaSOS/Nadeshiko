type MediaNameLanguage = 'english' | 'japanese' | 'romaji';

type HasMediaNames = {
  nameEn: string;
  nameJa: string;
  nameRomaji: string;
};

const localeToLanguage: Record<string, MediaNameLanguage> = {
  ja: 'japanese',
  en: 'english',
  es: 'english',
};

export function useMediaName() {
  const { locale } = useI18n();
  const store = userStore();

  const language = computed<MediaNameLanguage>(() => {
    if (store.isLoggedIn && store.preferences?.mediaNameLanguage) {
      return store.preferences.mediaNameLanguage as MediaNameLanguage;
    }
    return localeToLanguage[locale.value] ?? 'english';
  });

  const mediaName = (media: HasMediaNames): string => {
    switch (language.value) {
      case 'japanese':
        return media.nameJa || media.nameEn;
      case 'romaji':
        return media.nameRomaji || media.nameEn;
      default:
        return media.nameEn;
    }
  };

  return { mediaName, language };
}
