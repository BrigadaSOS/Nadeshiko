import { LOCALE_PREFERENCE_COOKIE_NAME, SUPPORTED_LOCALES } from '~/utils/i18n';

type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

function isSupportedLocale(value: string | null | undefined): value is SupportedLocale {
  return value !== null && value !== undefined && SUPPORTED_LOCALES.includes(value as SupportedLocale);
}

export function useLocalePreference() {
  const preferredLocale = useCookie<SupportedLocale | null>(LOCALE_PREFERENCE_COOKIE_NAME, {
    path: '/',
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 365,
    default: () => null,
  });

  const setPreferredLocale = (locale: string) => {
    if (!isSupportedLocale(locale)) return;
    preferredLocale.value = locale;
  };

  return {
    preferredLocale,
    setPreferredLocale,
    isSupportedLocale,
  };
}
