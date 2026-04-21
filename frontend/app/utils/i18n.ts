export const LOCALE_PREFERENCE_COOKIE_NAME = 'nd-locale-preference';
export const SUPPORTED_LOCALES = ['en', 'es', 'ja'] as const;

export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];
