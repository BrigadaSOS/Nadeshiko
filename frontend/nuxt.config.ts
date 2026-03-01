import { readFileSync } from 'node:fs';

const frontendPackageJson = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
  version?: string;
};

export default defineNuxtConfig({
  app: {
    head: {
      meta: [
        {
          name: 'description',
          content:
            'Online sentence search engine designed to display content from a wide variety of media including anime, J-dramas, films and more.',
        },
      ],
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
      sentryDsn: process.env.SENTRY_FRONTEND_DSN || '',
    },
  },
  pages: true,
  ssr: true,
  modules: [
    '@nuxtjs/tailwindcss',
    '@pinia/nuxt',
    '@nuxtjs/i18n',
    '@nuxtjs/seo',
    '@nuxt/content',
    'pinia-plugin-persistedstate/nuxt',
    '@vueuse/nuxt',
    'nuxt-umami',
    '@sentry/nuxt/module',
  ],
  umami: {
    id: '98441c04-c8f9-4882-93c8-0215535b02f1',
    host: 'https://cloud.umami.is',
    autoTrack: true,
  },
  site: {
    url: 'https://nadeshiko.co',
    name: 'Nadeshiko',
    description:
      'Online sentence search engine designed to display content from a wide variety of media including anime, J-dramas, films and more.',
  },
  robots: {
    groups: [
      {
        userAgent: '*',
        allow: ['/', '/search', '/media', '/sentence'],
        disallow: [
          '/settings',
          '/settings/',
          '/user',
          '/user/',
          '/admin',
          '/admin/',
          '/reports',
          '/reports/',
          '/api/',
          '/v1/',
        ],
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
      headers: {
        'CDN-Cache-Control': 'no-store',
        'Cache-Control': 'no-store',
      },
    },
    // Private/authenticated areas should never be indexed.
    '/settings/**': {
      robots: false,
    },
    '/user/**': {
      robots: false,
    },
    '/admin/**': {
      robots: false,
    },
    '/reports': {
      robots: false,
    },
    '/reports/**': {
      robots: false,
    },
    // Static assets are fine to cache (Nuxt fingerprints them)
    '/_nuxt/**': {
      headers: {
        'CDN-Cache-Control': 'public, max-age=31536000, immutable',
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    },
    // Public static assets — long cache, versioned by filename if needed
    '/assets/**': {
      headers: {
        'CDN-Cache-Control': 'public, max-age=31536000, immutable',
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    },
    '/favicon.ico': {
      headers: {
        'CDN-Cache-Control': 'public, max-age=604800, stale-while-revalidate=86400',
        'Cache-Control': 'public, max-age=604800, stale-while-revalidate=86400',
      },
    },
    '/github.png': {
      headers: {
        'CDN-Cache-Control': 'public, max-age=31536000, immutable',
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    },
    '/patreon.png': {
      headers: {
        'CDN-Cache-Control': 'public, max-age=31536000, immutable',
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    },
    '/logo.webp': {
      headers: {
        'CDN-Cache-Control': 'public, max-age=31536000, immutable',
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    },
    '/github/**': {
      headers: {
        'CDN-Cache-Control': 'public, max-age=31536000, immutable',
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    },
  },
  sentry: {
    sourceMapsUploadOptions: {
      org: process.env.SENTRY_ORG,
      project: process.env.SENTRY_PROJECT,
      authToken: process.env.SENTRY_AUTH_TOKEN,
    },
  },
  nitro: {
    preset: 'bun',
    rollupConfig: {
      onwarn(warning, defaultHandler) {
        if (warning.code === 'THIS_IS_UNDEFINED' || warning.code === 'CIRCULAR_DEPENDENCY') return;
        defaultHandler(warning);
      },
    },
  },
});
