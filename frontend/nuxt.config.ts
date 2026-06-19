import { readFileSync } from 'node:fs';
import { env } from './config/env';

const isDev = env.NUXT_PUBLIC_ENVIRONMENT === 'development';
const SITE_URL = isDev ? 'https://stg.nadeshiko.co' : 'https://nadeshiko.co';

const CDN_ORIGIN = 'https://cdn.nadeshiko.co';
const UMAMI_ORIGIN = 'https://cloud.umami.is';
const POSTHOG_ORIGIN = 'https://t.nadeshiko.co';
const CF_INSIGHTS_ORIGIN = 'https://static.cloudflareinsights.com';
const FARO_ORIGIN = 'https://o.nadeshiko.co';

const frontendPackageJson = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
  version?: string;
};

const SITEMAP_STATIC_PATHS = [
  '/about',
  '/privacy',
  '/terms-and-conditions',
  '/dmca',
  '/media',
  '/blog',
  '/stats',
  '/stats/words',
];
const SITEMAP_STATIC_URLS_EN = ['/en', ...SITEMAP_STATIC_PATHS.map((path) => `/en${path}`)];
const SITEMAP_STATIC_URLS_ES = ['/es', ...SITEMAP_STATIC_PATHS.map((path) => `/es${path}`)];

export default defineNuxtConfig({
  devServer: {
    host: '0.0.0.0',
  },
  vite: {
    server: {
      allowedHosts: true,
    },
    optimizeDeps: {
      include: ['@unhead/vue', '@grafana/faro-web-sdk', '@grafana/faro-web-tracing'],
    },
  },
  app: {
    head: {
      meta: [
        {
          name: 'description',
          content:
            'Search over 1 million Japanese sentences with English and Spanish translations from a wide variety of anime and J-dramas.',
        },
        { property: 'og:type', content: 'website' },
        { property: 'og:image:width', content: '1200' },
        { property: 'og:image:height', content: '630' },
        { name: 'twitter:card', content: 'summary_large_image' },
        { name: 'color-scheme', content: 'dark' },
      ],
      link: [
        { rel: 'icon', type: 'image/x-icon', href: '/favicon.ico' },
        { rel: 'search', type: 'application/opensearchdescription+xml', title: 'Nadeshiko', href: '/opensearch.xml' },
        { rel: 'preconnect', href: CDN_ORIGIN },
        { rel: 'preconnect', href: POSTHOG_ORIGIN },
      ],
    },
  },
  devtools: {
    enabled: process.dev,

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
      faroUrl: env.NUXT_PUBLIC_FARO_URL || '',
      faroAppName: env.NUXT_PUBLIC_FARO_APP_NAME || '',
    },
  },
  pages: true,
  ssr: true,
  modules: [
    '@nuxtjs/tailwindcss',
    '@pinia/nuxt',
    '@nuxtjs/i18n',
    '@nuxtjs/seo',
    'pinia-plugin-persistedstate/nuxt',
    '@vueuse/nuxt',
    'nuxt-umami',
    '@posthog/nuxt',

    '@nuxtjs/critters',
    'nuxt-security',
  ],
  security: {
    headers: {
      referrerPolicy: 'strict-origin-when-cross-origin',
      contentSecurityPolicy: process.dev
        ? false
        : {
            'default-src': ["'self'"],
            'script-src': [
              "'self'",
              "'unsafe-inline'",
              "'wasm-unsafe-eval'",
              UMAMI_ORIGIN,
              POSTHOG_ORIGIN,
              CF_INSIGHTS_ORIGIN,
              'https://www.youtube.com',
            ],
            'style-src': ["'self'", "'unsafe-inline'"],
            'img-src': ["'self'", 'data:', CDN_ORIGIN, UMAMI_ORIGIN],
            'font-src': ["'self'"],
            'connect-src': [
              "'self'",
              CDN_ORIGIN,
              UMAMI_ORIGIN,
              POSTHOG_ORIGIN,
              CF_INSIGHTS_ORIGIN,
              FARO_ORIGIN,

              'http://127.0.0.1:*',
              'http://localhost:*',
            ],
            'worker-src': ["'self'", 'blob:'],
            'media-src': ["'self'", 'blob:', CDN_ORIGIN],
            'object-src': ["'none'"],
            'frame-src': [
              "'self'",
              'https://discord.com',
              'https://www.youtube-nocookie.com',
              'https://www.youtube.com',
            ],
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
  posthogConfig: {
    publicKey: 'phc_vLnds6vZY3nKs6ZenhLnxSHTbYYH4EdS8zJ8mrBvHtjD',
    host: 'https://t.nadeshiko.co',
    clientConfig: {
      capture_exceptions: true,
      capture_pageview: true,
      capture_pageleave: false,
      autocapture: false,
    },
    serverConfig: {
      enableExceptionAutocapture: false,
    },
  },
  umami: {
    id: '98441c04-c8f9-4882-93c8-0215535b02f1',
    host: UMAMI_ORIGIN,
    autoTrack: true,
  },
  site: {
    url: SITE_URL,
    name: 'Nadeshiko',
    description:
      'Search over 1 million Japanese sentences with English and Spanish translations from a wide variety of anime and J-dramas.',
  },
  robots: isDev
    ? {
        groups: [{ userAgent: '*', disallow: ['/'] }],
      }
    : {
        groups: [
          {
            userAgent: '*',
            allow: ['/en/', '/es/', '/docs/'],
            disallow: [
              '/ja',
              '/ja/',
              '/en/settings',
              '/en/settings/',
              '/en/user',
              '/en/user/',
              '/en/admin',
              '/en/admin/',
              '/en/reports',
              '/en/reports/',
              '/es/settings',
              '/es/settings/',
              '/es/user',
              '/es/user/',
              '/es/admin',
              '/es/admin/',
              '/es/reports',
              '/es/reports/',
              '/api/',
              '/v1/',
              '/_nuxt/',
            ],
          },
        ],
        sitemap: `${SITE_URL}/sitemap_index.xml`,
      },
  sitemap: isDev
    ? false
    : {
        cacheMaxAgeSeconds: 86400,
        autoI18n: false,
        sitemaps: {
          en: {
            urls: SITEMAP_STATIC_URLS_EN,
            sources: [
              '/api/__sitemap__/media?locale=en',
              ['/api/__sitemap__/words?locale=en', { timeout: 60000 }],
              '/api/__sitemap__/blog?locale=en',
            ],
          },
          es: {
            urls: SITEMAP_STATIC_URLS_ES,
            sources: [
              '/api/__sitemap__/media?locale=es',
              ['/api/__sitemap__/words?locale=es', { timeout: 60000 }],
              '/api/__sitemap__/blog?locale=es',
            ],
          },
        },
      },
  ogImage: {
    enabled: false,
  },
  tailwindcss: {
    cssPath: '~/assets/css/tailwind.css',
  },
  i18n: {
    vueI18n: 'i18n.config.ts',
    locales: [
      {
        code: 'en',
        iso: 'en',
        name: 'English',
      },
      {
        code: 'es',
        iso: 'es',
        name: 'Español',
      },
      {
        code: 'ja',
        iso: 'ja',
        name: '日本語',
      },
    ],
    defaultLocale: 'en',
    strategy: 'prefix',
    // Required so hreflang alternates emit absolute URLs (Google needs absolute).
    baseUrl: SITE_URL,
    // Locale detection + redirect from / is handled in server/middleware/00-locale-router.ts
    // so it can run at the HTTP layer with proper Cache-Control on each branch.
    detectBrowserLanguage: false,
  },
  compatibilityDate: '2024-07-28',
  build: {
    transpile: ['vue-toastification'],
  },
  routeRules: {
    '/api/v1/docs': {
      redirect: { to: '/docs/api/index.html', statusCode: 301 },
    },
    // Caching policy: pages without an explicit rule emit no Cache-Control header.
    // Cloudflare doesn't cache HTML by default and browsers heuristically cache for
    // the same user only — fine. To make a page edge-cacheable across users, audit
    // it for SSR personalization (logged-in nav, hidden-media filter, content-rating
    // gating, etc.) and only then add a `public, s-maxage=...` rule below.
    //
    // `/` is the per-user locale router (server/middleware/00-locale-router.ts) and
    // must never be shared-cached.
    '/': { headers: { 'Cache-Control': 'private, no-store' } },
    // Block all indexing on dev environments
    ...(isDev && {
      '/**': {
        headers: { 'X-Robots-Tag': 'noindex, nofollow' },
      },
    }),
    // Private/authenticated areas should never be indexed.
    '/en/settings/**': { robots: false },
    '/en/user/**': { robots: false },
    '/en/admin/**': { robots: false },
    '/en/reports': { robots: false },
    '/en/reports/**': { robots: false },
    '/es/settings/**': { robots: false },
    '/es/user/**': { robots: false },
    '/es/admin/**': { robots: false },
    '/es/reports': { robots: false },
    '/es/reports/**': { robots: false },
    '/ja/**': { robots: false },
    // Homepage, blog index, blog posts, and static markdown pages are no longer
    // cached at the origin. Cloudflare Cache Rules are the single source of
    // truth for HTML caching; configure per-route there when needed.
    // See frontend/nuxt.config.ts commit log for the prior defaults.
    // Static assets are fine to cache (Nuxt fingerprints them)
    '/_nuxt/**': {
      headers: {
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    },
    // Public static assets — long cache, versioned by filename if needed
    '/assets/**': {
      headers: {
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    },
    '/favicon.ico': {
      headers: {
        'Cache-Control': 'public, max-age=604800, stale-while-revalidate=86400',
      },
    },
    '/github-c80c5ec0.png': {
      headers: {
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    },
    '/patreon-0c68395a.png': {
      headers: {
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    },
    '/logo-og-5bc76788.png': {
      headers: {
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    },
    '/logo-38d6e06a.webp': {
      headers: {
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    },
    '/github/**': {
      headers: {
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    },
  },
  sourcemap: { client: true },

  nitro: {
    preset: 'node-server',
    externals: {
      external: ['@opentelemetry/api'],
    },
    serverAssets: [
      {
        baseName: 'content',
        dir: '../content',
      },
    ],
    rollupConfig: {
      onwarn(warning, defaultHandler) {
        if (warning.code === 'THIS_IS_UNDEFINED' || warning.code === 'CIRCULAR_DEPENDENCY') return;
        defaultHandler(warning);
      },
    },
  },
});
