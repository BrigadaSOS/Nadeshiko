export default defineNuxtConfig({
  devtools: { enabled: true },
  runtimeConfig: {
    nadeshikoApiKey: process.env.NUXT_NADESHIKO_API_KEY,
    public: {
      environment: process.env.NUXT_APP_ENVIRONMENT,
      backendUrl: process.env.NUXT_PUBLIC_BACKEND_URL || 'http://localhost:5000',
    },
  },
  pages: true,
  ssr: true,
  modules: [
    "@nuxtjs/tailwindcss",
    "@pinia/nuxt",
    "@nuxtjs/i18n",
    "@nuxt/content",
    'pinia-plugin-persistedstate/nuxt',
    '@vueuse/nuxt'
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
      },
      {
        code: 'ja',
        iso: 'ja',
        file: 'ja.json',
        name: 'Japanese'
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
  },
  nitro: {
    preset: 'bun',
    externals: {
      external: ['@scalar/api-reference', '@scalar/themes', '@scalar/components']
    },
    logging: {
      level: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'development' ? 'debug' : 'info')
    }
  }
});
