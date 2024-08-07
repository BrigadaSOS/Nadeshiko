export default defineNuxtConfig({
  devtools: { enabled: true },
  runtimeConfig: {
    public: {
      baseURLBackend: process.env.NUXT_APP_BASE_URL_BACKEND,
      NUXT_APP_EXTENSION_KEY: process.env.NUXT_APP_EXTENSION_KEY,
    },
  },
  pages: true,
  modules: [
    "@nuxtjs/tailwindcss",
    "@pinia/nuxt",
    "@nuxtjs/i18n",
    "@nuxt/content",
    "@scalar/nuxt",
    "@nuxt/image",
    '@pinia-plugin-persistedstate/nuxt'
  ],
  
  plugins: ['~/plugins/preline.client.ts'],
  vite: {
    optimizeDeps: {
      include: ['@unhead/vue']
    }
  },
  i18n: {
    experimental: {
      localeDetector: './localeDetector.ts',
    },
    langDir: 'locales',
    lazy: true,
    locales: [
      {
        code: 'en',
        iso: 'en-US',
        file: 'en.json',
        name: 'English'
      },
      {
        code: 'es',
        iso: 'es-US',
        file: 'es.json',
        name: 'Spanish'
      }
    ],
    defaultLocale: 'en',
    strategy: "no_prefix",
     detectBrowserLanguage: {
       useCookie: true,
       alwaysRedirect: true,
       cookieKey: 'i18n_redirected',
       redirectOn: 'root'
     }
  },
  compatibilityDate: '2024-07-28',
  build: {
    transpile: ['vue-toastification'],
  }
});
