import AutoImport from 'unplugin-auto-import/vite'
import Components from 'unplugin-vue-components/vite'
// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  devtools: { enabled: true },

  runtimeConfig: {
    public: {
      baseURLBackend: process.env.NUXT_APP_BASE_URL_BACKEND,
    },
  },

  pages: true,

  modules: [
    "@nuxtjs/tailwindcss",
    "@pinia/nuxt",
    "@nuxtjs/i18n",
    "@nuxt/content",
    "@scalar/nuxt",
    "@nuxt/image"
  ],

  plugins: ['~/plugins/preline.client.ts'],

  vite: {
    // Prevent reload by optimizing dependency before discovery
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
   // vueI18n: './vue-i18n.options.ts'
  },

  compatibilityDate: '2024-07-28'
});