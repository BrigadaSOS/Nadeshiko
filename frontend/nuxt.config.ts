import { readFileSync } from 'node:fs';
import { env } from './config/env';
import { LOCALE_PREFERENCE_COOKIE_NAME } from './app/utils/i18n';

const isDev = env.NUXT_PUBLIC_ENVIRONMENT === 'development';
const SITE_URL = isDev ? 'https://dev.nadeshiko.co' : 'https://nadeshiko.co';

const CDN_ORIGIN = 'https://cdn.nadeshiko.co';
const UMAMI_ORIGIN = 'https://cloud.umami.is';
const POSTHOG_ORIGIN = 'https://t.nadeshiko.co';
const CF_INSIGHTS_ORIGIN = 'https://static.cloudflareinsights.com';
const OTEL_ORIGIN = 'https://o.nadeshiko.co';

const frontendPackageJson = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
  version?: string;
};

const SITEMAP_STATIC_URLS = ['/', '/about', '/privacy', '/terms-and-conditions', '/dmca', '/media', '/blog', '/stats', '/stats/words'];
const SITEMAP_STATIC_URLS_ES = SITEMAP_STATIC_URLS.map((path) => (path === '/' ? '/es' : `/es${path}`));

export default defineNuxtConfig({
  devServer: {
    host: '0.0.0.0',
  },
  vite: {
    server: {
      allowedHosts: true,
    },
    optimizeDeps: {
      include: [
        '@unhead/vue',
        '@opentelemetry/sdk-trace-web',
        '@opentelemetry/sdk-trace-base',
        '@opentelemetry/exporter-trace-otlp-http',
        '@opentelemetry/resources',
        '@opentelemetry/context-zone',
        '@opentelemetry/instrumentation-document-load',
        '@opentelemetry/instrumentation-fetch',
        '@opentelemetry/instrumentation',
      ],
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
      otelCollectorUrl: '',
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
    headers: process.dev
      ? false
      : {
          contentSecurityPolicy: {
            'default-src': ["'self'"],
            'script-src': [
              "'self'",
              "'unsafe-inline'",
              "'wasm-unsafe-eval'",
              UMAMI_ORIGIN,
              POSTHOG_ORIGIN,
              CF_INSIGHTS_ORIGIN,
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
              OTEL_ORIGIN,

              'http://127.0.0.1:*',
              'http://localhost:*',
            ],
            'worker-src': ["'self'", 'blob:'],
            'media-src': ["'self'", 'blob:', CDN_ORIGIN],
            'object-src': ["'none'"],
            'frame-src': ["'self'", 'https://discord.com'],
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
      capture_pageleave: true,
    },
    serverConfig: {
      enableExceptionAutocapture: true,
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
            allow: ['/', '/search', '/media', '/sentence', '/stats', '/blog', '/about', '/docs/', '/es/'],
            disallow: [
              '/ja',
              '/ja/',
              '/settings',
              '/settings/',
              '/user',
              '/user/',
              '/admin',
              '/admin/',
              '/reports',
              '/reports/',
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
            urls: SITEMAP_STATIC_URLS,
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
    strategy: 'prefix_except_default',
    detectBrowserLanguage: {
      redirectOn: 'root',
      useCookie: true,
      alwaysRedirect: false,
      cookieKey: LOCALE_PREFERENCE_COOKIE_NAME,
      fallbackLocale: 'en',
    },
  },
  compatibilityDate: '2024-07-28',
  build: {
    transpile: ['vue-toastification'],
  },
  routeRules: {
    '/api/v1/docs': {
      redirect: { to: '/docs/api/index.html', statusCode: 301 },
    },
    // Public pages — cached at Cloudflare edge, short TTL so content stays fresh.
    // Requires a Cloudflare Cache Rule matching these paths with "Eligible for cache".
    '/': { headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=60' } },
    '/es': { headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=60' } },
    '/ja': { headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=60' } },
    '/about': { headers: { 'Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=3600' } },
    '/es/about': { headers: { 'Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=3600' } },
    '/ja/about': { headers: { 'Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=3600' } },
    '/stats': { headers: { 'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=300' } },
    '/es/stats': { headers: { 'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=300' } },
    '/ja/stats': { headers: { 'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=300' } },
    // Block all indexing on dev environments
    ...(isDev && {
      '/**': {
        headers: { 'X-Robots-Tag': 'noindex, nofollow' },
      },
    }),
    // Private/authenticated areas should never be indexed.
    '/settings/**': { robots: false },
    '/user/**': { robots: false },
    '/admin/**': { robots: false },
    '/reports': { robots: false },
    '/reports/**': { robots: false },
    '/es/settings/**': { robots: false },
    '/es/user/**': { robots: false },
    '/es/admin/**': { robots: false },
    '/es/reports': { robots: false },
    '/es/reports/**': { robots: false },
    '/ja/**': { robots: false },
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
  sourcemap: { client: 'hidden' },

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
