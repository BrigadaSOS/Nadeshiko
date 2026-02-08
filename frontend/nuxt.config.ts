import { readFileSync } from 'node:fs';

const frontendPackageJson = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
  version?: string;
};

export default defineNuxtConfig({
  devtools: {
    enabled: process.env.NODE_ENV === 'development',

    timeline: {
      enabled: true,
    },
  },
  css: ['~/assets/css/tailwind.css'],
  runtimeConfig: {
    nadeshikoApiKey: process.env.NUXT_NADESHIKO_API_KEY,
    backendInternalUrl: process.env.NUXT_BACKEND_INTERNAL_URL,
    mediaFilesPath: process.env.NUXT_MEDIA_FILES_PATH,
    fallbackRateLimitWindowMs: Number(process.env.NUXT_FALLBACK_RATE_LIMIT_WINDOW_MS || 60000),
    fallbackRateLimitMaxRequests: Number(process.env.NUXT_FALLBACK_RATE_LIMIT_MAX_REQUESTS || 300),
    public: {
      appVersion: frontendPackageJson.version,
      environment: process.env.NUXT_APP_ENVIRONMENT || 'local',
    },
  },
  pages: true,
  ssr: true,
  modules: [
    '@nuxtjs/tailwindcss',
    '@pinia/nuxt',
    '@nuxtjs/i18n',
    '@nuxt/content',
    'pinia-plugin-persistedstate/nuxt',
    '@vueuse/nuxt',
  ],
  tailwindcss: {
    cssPath: '~/assets/css/tailwind.css',
  },
  vite: {
    optimizeDeps: {
      include: ['@unhead/vue'],
    },
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
        name: 'English',
      },
      {
        code: 'es',
        iso: 'es-US',
        file: 'es.json',
        name: 'Spanish',
      },
      {
        code: 'ja',
        iso: 'ja',
        file: 'ja.json',
        name: 'Japanese',
      },
    ],
    defaultLocale: 'en',
    strategy: 'no_prefix',
    detectBrowserLanguage: {
      useCookie: true,
      alwaysRedirect: true,
      cookieKey: 'i18n_redirected',
      redirectOn: 'root',
    },
  },
  compatibilityDate: '2024-07-28',
  build: {
    transpile: ['vue-toastification'],
  },
  nitro: {
    preset: 'bun',
    externals: {
      external: ['@scalar/api-reference', '@scalar/themes', '@scalar/components'],
    },
  },
});
