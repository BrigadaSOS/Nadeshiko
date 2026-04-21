const COOKIE_NAME = 'nd-locale-preference';
const SUPPORTED_LOCALES = ['en', 'es', 'ja'] as const;

type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

function isSupportedLocale(value: string | null | undefined): value is SupportedLocale {
  return value !== null && value !== undefined && SUPPORTED_LOCALES.includes(value as SupportedLocale);
}

export function useLocalePreference() {
  const preferredLocale = useCookie<SupportedLocale | null>(COOKIE_NAME, {
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
