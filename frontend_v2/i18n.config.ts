import en from "./locales/en.json";
import es from "./locales/es.json";

export default defineI18nConfig(() => ({
  detectBrowserLanguage: {
    useCookie: true,
    cookieKey: "i18n_redirected",
    redirectOn: "root",
  },
  legacy: false,
  fallbackLocale: "en",
  availableLocales: ["es", "en"],
  messages: {
    en,
    es,
  },
}));
