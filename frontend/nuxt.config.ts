import { readFileSync } from 'node:fs';
import { env } from './config/env';

const CDN_ORIGIN = 'https://cdn.nadeshiko.co';
const UMAMI_ORIGIN = 'https://cloud.umami.is';
const SENTRY_INGEST = 'https://*.ingest.de.sentry.io';

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
            'Search over 1 million Japanese sentences with English and Spanish translations from a wide variety of anime and J-dramas.',
        },
      ],
      link: [
        { rel: 'icon', type: 'image/png', href: '/logo-og.png' },
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
    nadeshikoApiKey: env.NUXT_NADESHIKO_API_KEY,
    backendInternalUrl: env.NUXT_BACKEND_INTERNAL_URL,
    backendHostHeader: env.NUXT_BACKEND_HOST_HEADER,
    mediaFilesPath: env.NUXT_MEDIA_FILES_PATH,
    fallbackRateLimitWindowMs: env.NUXT_FALLBACK_RATE_LIMIT_WINDOW_MS,
    fallbackRateLimitMaxRequests: env.NUXT_FALLBACK_RATE_LIMIT_MAX_REQUESTS,
    public: {
      appVersion: frontendPackageJson.version,
      environment: env.NUXT_PUBLIC_ENVIRONMENT,
      sentryDsn: env.SENTRY_FRONTEND_DSN || '',
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
    '@nuxtjs/critters',
    'nuxt-security',
  ],
  security: {
    headers: {
      contentSecurityPolicy: {
        'default-src': ["'self'"],
        'script-src': ["'self'", "'unsafe-inline'", "'wasm-unsafe-eval'", UMAMI_ORIGIN],
        'style-src': ["'self'", "'unsafe-inline'"],
        'img-src': ["'self'", 'data:', CDN_ORIGIN, UMAMI_ORIGIN],
        'font-src': ["'self'"],
        'connect-src': ["'self'", CDN_ORIGIN, UMAMI_ORIGIN, SENTRY_INGEST, 'http://127.0.0.1:*', 'http://localhost:*'],
        'worker-src': ["'self'", 'blob:'],
        'media-src': ["'self'", 'blob:', CDN_ORIGIN],
        'object-src': ["'none'"],
        'frame-ancestors': ["'none'"],
        'base-uri': ["'self'"],
        'form-action': ["'self'"],
      },
      // COEP disabled: cross-origin media from cdn.nadeshiko.co lacks CORP headers
      crossOriginEmbedderPolicy: false,
    },
    rateLimiter: false,
    xssValidator: false,
    requestSizeLimiter: false,
    corsHandler: false,
  },
  umami: {
    id: '98441c04-c8f9-4882-93c8-0215535b02f1',
    host: UMAMI_ORIGIN,
    autoTrack: true,
  },
  site: {
    url: 'https://nadeshiko.co',
    name: 'Nadeshiko: Japanese Sentence Search Engine',
    description:
      'Search over 1 million Japanese sentences with English and Spanish translations from a wide variety of anime and J-dramas.',
  },
  robots: {
    groups: [
      {
        userAgent: '*',
        allow: ['/', '/search', '/media', '/sentence', '/api/v1/docs', '/docs/'],
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
    urls: ['/', '/about', '/privacy', '/terms-and-conditions', '/dmca', '/media', '/api/v1/docs', '/docs/api/index.html'],
    autoI18n: false,
  },
  ogImage: {
    defaults: {
      component: 'OgImageDefault',
    },
    fonts: ['Space+Grotesk:400', 'Space+Grotesk:700', 'Noto+Sans+JP:400', 'Noto+Sans+JP:700'],
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
        file: 'en.ts',
        name: 'English',
      },
      {
        code: 'es',
        iso: 'es-US',
        file: 'es.ts',
        name: 'Spanish',
      },
      {
        code: 'ja',
        iso: 'ja',
        file: 'ja.ts',
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
    '/__og-image__/**': {
      headers: {
        'CDN-Cache-Control': 'public, max-age=86400, stale-while-revalidate=3600',
        'Cache-Control': 'public, max-age=86400, stale-while-revalidate=3600',
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
    '/logo-og.png': {
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
  sourcemap: { client: 'hidden' },
  sentry: {
    sourceMapsUploadOptions: {
      org: process.env.SENTRY_ORG,
      project: process.env.SENTRY_PROJECT,
      authToken: process.env.SENTRY_AUTH_TOKEN,
    },
    sourcemaps: {
      filesToDeleteAfterUpload: ['.output/**/public/**/*.map'],
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
