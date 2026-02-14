import { readFileSync } from 'node:fs';

const frontendPackageJson = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
  version?: string;
};

export default defineNuxtConfig({
  app: {
    head: {
      link: [
        { rel: 'search', type: 'application/opensearchdescription+xml', title: 'Nadeshiko', href: '/opensearch.xml' },
      ],
    },
  },
  devtools: {
    enabled: process.env.NODE_ENV === 'dev',

    timeline: {
      enabled: true,
    },
  },
  css: ['~/assets/css/tailwind.css'],
  runtimeConfig: {
    nadeshikoApiKey: process.env.NUXT_NADESHIKO_API_KEY,
    backendInternalUrl: process.env.NUXT_BACKEND_INTERNAL_URL,
    backendHostHeader: process.env.NUXT_BACKEND_HOST_HEADER,
    mediaFilesPath: process.env.NUXT_MEDIA_FILES_PATH,
    fallbackRateLimitWindowMs: Number(process.env.NUXT_FALLBACK_RATE_LIMIT_WINDOW_MS || 60000),
    fallbackRateLimitMaxRequests: Number(process.env.NUXT_FALLBACK_RATE_LIMIT_MAX_REQUESTS || 300),
    public: {
      appVersion: frontendPackageJson.version,
      environment: process.env.NUXT_PUBLIC_ENVIRONMENT || 'prod',
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
    '@nuxtjs/seo',
  ],
  site: {
    url: 'https://nadeshiko.co',
    name: 'Nadeshiko',
  },
  robots: {
    groups: [
      {
        userAgent: '*',
        allow: ['/', '/search', '/media', '/sentence'],
        disallow: ['/settings', '/api/', '/v1/'],
      },
    ],
    sitemap: 'https://nadeshiko.co/sitemap.xml',
  },
  sitemap: {
    urls: ['/', '/about', '/privacy', '/terms-and-conditions', '/dmca', '/media'],
  },
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
  routeRules: {
    // SSR pages vary by user (auth, language) — never cache on CDN
    '/**': {
      headers: { 'CDN-Cache-Control': 'no-store' },
    },
    // Static assets are fine to cache (Nuxt fingerprints them)
    '/_nuxt/**': {
      headers: { 'CDN-Cache-Control': 'public, max-age=31536000, immutable' },
    },
  },
  nitro: {
    preset: 'bun',
    externals: {
      external: ['@scalar/api-reference', '@scalar/themes', '@scalar/components'],
    },
  },
});
