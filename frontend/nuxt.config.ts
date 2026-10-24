import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { env } from './config/env';
import { INDEXED_LOCALES as APP_INDEXED_LOCALES } from './app/utils/i18n';
import { PRIVATE_PATH_SEGMENTS } from './shared/utils/privatePaths';
import { DISCORD_INVITE_URL } from './shared/utils/socialLinks';
import { DEFAULT_OG_IMAGE_PATH } from './app/utils/metaTags';

const isDev = env.NUXT_PUBLIC_ENVIRONMENT === 'development';
// Production-only analytics avoid CSP noise and mixing non-production events into the real project.
// Without the module, captures guarded by `posthog.__loaded` are no-ops.
const isProd = env.NUXT_PUBLIC_ENVIRONMENT === 'production';
// `process.dev` is not injected into this Node-evaluated config; use the explicit environment for local CSP.
const isLocal = env.NUXT_PUBLIC_ENVIRONMENT === 'local';
const SITE_URL = isDev ? 'https://stg.nadeshiko.co' : 'https://nadeshiko.co';

const CDN_ORIGIN = 'https://cdn.nadeshiko.co';

// Shirabe lookup responses supply pronunciation clip URLs; allow its CDN for media only.
const SHIRABE_CDN_ORIGIN = 'https://cdn.shirabe.org';
// Dictionary/mining extensions inject passive assets governed by the page CSP.
// Allow fonts, images and styles without granting extension script execution.
const MIGAKU_ASSET_ORIGIN = 'https://migaku-public-data.migaku.com';
const GOOGLE_FONTS_ORIGIN = 'https://fonts.googleapis.com';
const GOOGLE_FONTS_STATIC_ORIGIN = 'https://fonts.gstatic.com';
const TYPEKIT_ORIGIN = 'https://use.typekit.net';
// YouTube supplies thumbnails from both i.ytimg.com and numbered subdomains; allow all image hosts.
const YOUTUBE_THUMBNAIL_ORIGIN = 'https://*.ytimg.com';
// Trust the dedicated roadmap image CDN, not AniList scripts or API origins.
const ANILIST_IMAGE_ORIGIN = 'https://s4.anilist.co';
const MYANIMELIST_IMAGE_ORIGIN = 'https://cdn.myanimelist.net';
// Chrome Translate needs these stylesheet/icon origins plus its translation API.
// Its privileged script injection does not need a script-src allowance.
const GSTATIC_ORIGIN = 'https://www.gstatic.com';
// Yandex Browser's translator loads icons here; images only.
const YANDEX_STATIC_ORIGIN = 'https://yastatic.net';
const GOOGLE_TRANSLATE_ORIGIN = 'https://translate.google.com';
const GOOGLE_TRANSLATE_API_ORIGIN = 'https://translate-pa.googleapis.com';

const BUILD_ID = randomUUID();

const POSTHOG_ORIGIN = 'https://t.nadeshiko.co';
const POSTHOG_PUBLIC_KEY = 'phc_vLnds6vZY3nKs6ZenhLnxSHTbYYH4EdS8zJ8mrBvHtjD';
// Proxy CSP reports through our own PostHog host to avoid content blockers; `/report/` requires its trailing slash.
// Reports bypass connect-src. Sample at 10% because extension reports dominate and PostHog creates phantom
// persons for anonymous batches, while retaining enough first-party reports to spot regressions.
// If full first-party coverage is needed, add a collector that filters extension noise before forwarding.
const CSP_REPORT_URI = `${POSTHOG_ORIGIN}/report/?token=${POSTHOG_PUBLIC_KEY}&sample_rate=0.1`;
const CF_INSIGHTS_ORIGIN = 'https://static.cloudflareinsights.com';

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
  '/changelog',
  '/stats',
  '/stats/words',
  // Expose every tier so crawlers can reach word pages. COVERED excludes words whose empty search pages are
  // noindex; canonical.ts allowlists both query params.
  ...[1000, 2000, 5000, 10000, 20000, 50000, 100000].map((tier) => `/stats/words?tier=${tier}&filter=COVERED`),
];
const sitemapStaticUrls = (locale: string) => [
  `/${locale}`,
  ...SITEMAP_STATIC_PATHS.map((path) => `/${locale}${path}`),
];

// Share indexed locales with canonical.ts so robots rules and hreflang alternates agree.
const INDEXED_LOCALES = APP_INDEXED_LOCALES;

const sitemapSources = (
  locale: (typeof INDEXED_LOCALES)[number],
): [string, [string, { timeout: number }], [string, { timeout: number }], string] => [
  `/api/__sitemap__/media?locale=${locale}`,
  [`/api/__sitemap__/episodes?locale=${locale}`, { timeout: 60000 }],
  // Sentence sampling makes two lookups per title; allow more time than episode enumeration.
  [`/api/__sitemap__/sentences?locale=${locale}`, { timeout: 90000 }],
  `/api/__sitemap__/blog?locale=${locale}`,
];

// Derive both slash variants from the same private-path list used by route rules.
const PRIVATE_DISALLOW = INDEXED_LOCALES.flatMap((locale) =>
  PRIVATE_PATH_SEGMENTS.flatMap((segment) => [`/${locale}${segment}`, `/${locale}${segment}/`]),
);

const PRIVATE_ROUTE_RULES = Object.fromEntries(
  INDEXED_LOCALES.flatMap((locale) =>
    PRIVATE_PATH_SEGMENTS.map((segment) => [`/${locale}${segment}/**`, { robots: false }] as const),
  ),
);

export default defineNuxtConfig({
  devServer: {
    host: '0.0.0.0',
  },
  vite: {
    server: {
      allowedHosts: true,
    },
    optimizeDeps: {
      include: ['@unhead/vue'],
    },
  },
  app: {
    buildAssetsDir: `/_nuxt/${BUILD_ID}/`,

    head: {
      // Put the dark class on <html> so body-teleported modals inherit dark utilities and CSS variables.
      // Render it on the server to avoid a light flash during hydration.
      htmlAttrs: { class: 'dark' },
      meta: [
        {
          name: 'description',
          content:
            'Search over 1 million Japanese sentences with English and Spanish translations from a wide variety of anime and J-dramas.',
        },
        { property: 'og:type', content: 'website' },
        // Image dimensions belong with each image in buildOgImageTags; global defaults misdescribe page overrides.
        { name: 'twitter:card', content: 'summary_large_image' },
        { name: 'color-scheme', content: 'dark' },
      ],
      link: [
        { rel: 'icon', type: 'image/x-icon', href: '/favicon.ico' },
        { rel: 'search', type: 'application/opensearchdescription+xml', title: 'Nadeshiko', href: '/opensearch.xml' },
        { rel: 'preconnect', href: CDN_ORIGIN },
        ...(isProd ? [{ rel: 'preconnect' as const, href: POSTHOG_ORIGIN }] : []),
      ],
    },
  },
  devtools: {
    enabled: isLocal,

    timeline: {
      enabled: true,
    },
  },
  css: ['~/assets/css/tailwind.css'],
  runtimeConfig: {
    releaseSha: env.NUXT_RELEASE_SHA,
    nadeshikoApiKey: env.NUXT_NADESHIKO_API_KEY,
    // Keep the service key server-side; anything under public is shipped to the browser.
    shirabeApiKey: env.NUXT_SHIRABE_API_KEY,
    shirabeApiBase: env.NUXT_SHIRABE_API_BASE || 'https://shirabe.org',
    // Optional tailnet fast path; the lookup route falls back to the public host, changing latency only.
    shirabeApiDirect: env.NUXT_SHIRABE_API_DIRECT || '',
    internalProxySecret: env.NUXT_INTERNAL_PROXY_SECRET,
    backendInternalUrl: env.NUXT_BACKEND_INTERNAL_URL,
    backendHostHeader: env.NUXT_BACKEND_HOST_HEADER,
    mediaFilesPath: env.NUXT_MEDIA_FILES_PATH,
    // Keep prior builds servable for open tabs. Read by server/plugins/03-asset-archive.ts; unset disables it.
    assetArchiveDir: env.NUXT_ASSET_ARCHIVE_DIR,
    assetArchiveDays: env.NUXT_ASSET_ARCHIVE_DAYS,
    sitemapSnapshotDir: env.NUXT_SITEMAP_SNAPSHOT_DIR || '',
    // Declare the Reporting-Endpoints URI alongside report-to, only in production.
    ...(isProd && { cspReportUri: `${CSP_REPORT_URI}&type=report-to` }),
    public: {
      appVersion: frontendPackageJson.version,
      environment: env.NUXT_PUBLIC_ENVIRONMENT,
      // Reader-facing settings URL, distinct from the possibly private server API address; no key is exposed.
      shirabeSite: env.NUXT_PUBLIC_SHIRABE_SITE || 'https://shirabe.org',
      // Expose only whether lookups are configured, not the key, to avoid doomed hover requests.
      // Without lookups, cards still show token-provided word, reading and grammar.
      shirabeLookups: Boolean(env.NUXT_SHIRABE_API_KEY),
    },
  },
  // Restrict scanning to Vue SFCs so colocated TypeScript helpers do not become phantom components.
  components: [{ path: '~/components', pathPrefix: true, extensions: ['vue'] }],

  pages: true,
  ssr: true,
  modules: [
    '@nuxtjs/tailwindcss',
    '@pinia/nuxt',
    '@nuxtjs/i18n',
    '@nuxtjs/seo',
    'pinia-plugin-persistedstate/nuxt',
    '@vueuse/nuxt',
    ...(isProd ? ['@posthog/nuxt'] : []),
    '@nuxtjs/critters',
    'nuxt-security',
  ],
  // Critters' default media preload uses a CSP-blocked inline onload; use its nonce-bearing script strategy.
  critters: {
    config: {
      preload: 'media-script',
    },
  },
  // Register the shim only without @posthog/nuxt so it cannot shadow the production composable.
  ...(isProd ? {} : { imports: { dirs: ['shims/posthog'] } }),
  security: {
    // Nonce-bearing SSR scripts require a fresh render per request. Prerendered/shared-cached HTML would carry
    // a nonce that disagrees with the response header and block inline scripts.
    nonce: true,
    headers: {
      referrerPolicy: 'strict-origin-when-cross-origin',
      contentSecurityPolicy: isLocal
        ? false
        : {
            // PostHog remote-config fetching can fall back to default-src; explicit script/connect allowances are not enough.
            'default-src': ["'self'", POSTHOG_ORIGIN],
            // Do not admit extension inline scripts: unsafe-inline is ignored with a nonce, and removing nonces weakens
            // the policy. Extensions may still inject through their non-inline paths.
            'script-src': [
              // Keep 'self': narrowing to /_nuxt/ cannot block Cloudflare JS Detections. Cloudflare copies the request nonce
              // onto its injected script, bypassing host/path sources. Disabling it requires a zone/plan change
              // (see brigadasos-infra/terraform/cloudflare-security.tf), not a narrower CSP.
              "'self'",
              "'nonce-{{nonce}}'",
              "'wasm-unsafe-eval'",
              POSTHOG_ORIGIN,
              CF_INSIGHTS_ORIGIN,
              'https://www.youtube.com',
            ],
            'style-src': ["'self'", "'unsafe-inline'", GOOGLE_FONTS_ORIGIN, GSTATIC_ORIGIN],
            'img-src': [
              "'self'",
              'data:',
              CDN_ORIGIN,
              YOUTUBE_THUMBNAIL_ORIGIN,
              ANILIST_IMAGE_ORIGIN,
              MYANIMELIST_IMAGE_ORIGIN,
              GOOGLE_FONTS_STATIC_ORIGIN,
              GOOGLE_TRANSLATE_ORIGIN,
              YANDEX_STATIC_ORIGIN,
              // Allow canvas/object-URL images without granting script execution.
              'blob:',
            ],
            // Extensions may inline fonts as data URLs.
            'font-src': ["'self'", 'data:', MIGAKU_ASSET_ORIGIN, GOOGLE_FONTS_STATIC_ORIGIN, TYPEKIT_ORIGIN],
            'connect-src': [
              "'self'",
              CDN_ORIGIN,
              POSTHOG_ORIGIN,
              CF_INSIGHTS_ORIGIN,
              GOOGLE_TRANSLATE_API_ORIGIN,

              // AnkiConnect is called directly by the browser. Allow IPv4, hostname and IPv6 loopback on any configured port.
              // LAN addresses are unsupported: CSP cannot wildcard private IP ranges, and allowing all http: origins is
              // unsafe alongside v-html. The store reports blocked_by_csp for those setups.
              // Do not equate Android with LAN use: loopback AnkiConnect exists there too; address_kind records the distinction.
              'http://127.0.0.1:*',
              'http://localhost:*',
              'http://[::1]:*',
            ],
            'worker-src': ["'self'", 'blob:'],
            // Allow self-contained inline media as well as object URLs.
            'media-src': ["'self'", 'blob:', 'data:', CDN_ORIGIN, SHIRABE_CDN_ORIGIN],
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
            // Chrome uses report-to; Firefox/Safari need report-uri. The named endpoint is emitted by
            // 98-html-response-headers.ts. Production only to keep staging noise out of the real PostHog project.
            ...(isProd && {
              'report-uri': [`${CSP_REPORT_URI}&type=report-uri`],
              'report-to': 'posthog',
            }),
          },
      // COEP disabled: cross-origin media from cdn.nadeshiko.co lacks CORP headers
      crossOriginEmbedderPolicy: false,
    },
    rateLimiter: false,
    xssValidator: false,
    requestSizeLimiter: false,
    corsHandler: false,
  },
  ...(isProd && {
    posthogConfig: {
      publicKey: POSTHOG_PUBLIC_KEY,
      host: POSTHOG_ORIGIN,
      clientConfig: {
        capture_exceptions: true,
        capture_pageview: true,
        capture_pageleave: false,
        autocapture: false,
        // Surveys are unused; disable their runtime download until a survey ships.
        disable_surveys: true,
      },
      serverConfig: {
        enableExceptionAutocapture: false,
      },
      // Source-map upload rewrites JS after nuxt-security hashes it. modules/sri-after-asset-mutations.ts must
      // recompute digests from final output or SRI blocks hydration. This production-only path is checked by
      // verify-sri inside the image build; staging does not exercise it.
      sourcemaps: {
        enabled: Boolean(process.env.POSTHOG_CLI_API_KEY),
        projectId: '372788',
        // The module requires a string even in keyless typecheck contexts; enabled is false when the key is absent.
        personalApiKey: process.env.POSTHOG_CLI_API_KEY ?? '',
      },
    },
  }),
  hooks: {
    // Replace the module's static posthog-js client import with our asynchronous plugin to keep the SDK out of
    // the hydration entry chunk. Keep its server plugin, composables and source-map upload.
    // Fail if an upgrade moves the plugin: silently retaining it would initialise two SDKs and restore the heavy import.
    'app:resolve'(app) {
      if (!isProd) return;

      const before = app.plugins.length;
      app.plugins = app.plugins.filter((plugin) => !plugin.src.includes('@posthog/nuxt/dist/runtime/vue-plugin'));

      if (app.plugins.length === before) {
        throw new Error(
          "@posthog/nuxt's client plugin was not found at dist/runtime/vue-plugin, so it could not be replaced " +
            'by app/plugins/posthog.client.ts. Leaving it in place would re-add posthog-js to the entry chunk ' +
            'and initialise the SDK twice. Update the path in the app:resolve hook in nuxt.config.ts.',
        );
      }
    },
  },
  // Set the publisher logo on the module-owned #identity node; a page-level Organization creates a separate
  // #organization node that WebSite/WebPage/Article references do not use.
  schemaOrg: {
    identity: {
      type: 'Organization',
      name: 'Nadeshiko',
      url: SITE_URL,
      logo: `${SITE_URL}${DEFAULT_OG_IMAGE_PATH}`,
      sameAs: ['https://github.com/BrigadaSOS', 'https://www.patreon.com/BrigadaSOS', DISCORD_INVITE_URL],
    },
  },
  site: {
    url: SITE_URL,
    name: 'Nadeshiko',
    // Language-neutral fallback; app.vue supplies localized descriptions so WebSite language and text agree.
    description: 'Search over 1 million Japanese sentences from a wide variety of anime and J-dramas.',
  },
  robots: isDev
    ? {
        groups: [{ userAgent: '*', disallow: ['/'] }],
      }
    : {
        groups: [
          {
            userAgent: '*',
            // Do not allow /docs/ here: i18n expands it into nonexistent localized paths. The real /docs/** route uses noindex.
            allow: ['/en/', '/es/'],
            // Keep /ja crawlable until Search Console confirms de-indexing: disallow would hide its existing noindex header.
            // Then restore /ja and /ja/ disallows to save crawl budget.
            disallow: [...PRIVATE_DISALLOW, '/api/', '/v1/', '/_nuxt/'],
          },
          // Block compliant commercial backlink crawlers; keep AhrefsBot for reporting we use.
          // _skipI18n avoids expanding an already universal / disallow into redundant locale entries.
          {
            userAgent: ['MJ12bot', 'DotBot'],
            disallow: ['/'],
            _skipI18n: true,
          },
          // Block training crawlers, not answer/citation crawlers; mirrors brigadasos-infra/cloudflare-security.tf.
          // robots.txt covers compliant crawlers before edge verification. Google-Extended is a usage token, not a crawler,
          // so only robots.txt can exclude Gemini training without blocking Googlebot indexing.
          // This is not a fence against bots impersonating browsers. _skipI18n keeps the universal disallow unexpanded.
          {
            userAgent: ['GPTBot', 'ClaudeBot', 'CCBot', 'Google-Extended', 'Applebot-Extended', 'meta-externalagent'],
            disallow: ['/'],
            _skipI18n: true,
          },
        ],
        sitemap: `${SITE_URL}/sitemap_index.xml`,
      },
  sitemap: isDev
    ? false
    : {
        cacheMaxAgeSeconds: 86400,
        // Share warmed sitemaps across workers and worker replacements. Container-local storage starts fresh on release.
        runtimeCacheStorage: { driver: 'fs', base: '/tmp/nadeshiko-sitemap-cache' },
        autoI18n: false,
        sitemaps: Object.fromEntries(
          INDEXED_LOCALES.map((locale) => [
            locale,
            { urls: sitemapStaticUrls(locale), sources: sitemapSources(locale) },
          ]),
        ),
      },
  ogImage: {
    enabled: false,
  },
  tailwindcss: {
    cssPath: '~/assets/css/tailwind.css',
  },
  i18n: {
    vueI18n: 'i18n.config.ts',
    // v10 uses language, not iso, for hreflang. Declare locale files so the module loads only the active language
    // instead of bundling every translation into the entry chunk.
    locales: [
      {
        code: 'en',
        language: 'en',
        name: 'English',
        file: 'en.json',
      },
      {
        code: 'es',
        language: 'es',
        name: 'Español',
        file: 'es.json',
      },
      {
        code: 'id',
        language: 'id',
        name: 'Bahasa Indonesia',
        file: 'id.json',
      },
      {
        code: 'pt-BR',
        language: 'pt-BR',
        name: 'Português (Brasil)',
        file: 'pt-BR.json',
      },
      {
        code: 'ja',
        language: 'ja',
        name: '日本語',
        file: 'ja.json',
      },
      {
        // Keep /zh compact while declaring the writing system precisely.
        code: 'zh',
        language: 'zh-Hans',
        name: '简体中文',
        file: 'zh-CN.json',
      },
      {
        code: 'zh-hant',
        language: 'zh-Hant',
        name: '繁體中文',
        file: 'zh-Hant.json',
      },
    ],
    defaultLocale: 'en',
    strategy: 'prefix',
    baseUrl: SITE_URL,
    // 00-locale-router.ts owns HTTP locale redirects and their per-branch Cache-Control.
    detectBrowserLanguage: false,
    // Cache hash-addressed locale messages for a day on the server and client; defaults disable server caching
    // or allow only 10 seconds in browsers. Content hashes make these URLs immutable.
    // Both options are experimental; check their names after i18n upgrades if messages become hot in SSR logs.
    experimental: {
      cacheLifetime: 60 * 60 * 24,
      httpCacheDuration: 60 * 60 * 24,
    },
  },
  // Check for deploys every five minutes instead of an hour to shrink the stale-tab import window.
  // This only reduces the race; per-build asset URLs and the archive below preserve old bytes. The poll only
  // works because 03-latest-build-manifest.ts answers every build's latest.json with the running build's.
  experimental: {
    checkOutdatedBuildInterval: 5 * 60 * 1000,
  },

  // PostHog injects IDs after Vite hashes filenames, so unchanged chunk names can acquire new bytes.
  // Use one URL directory per build to avoid archive collisions and stale-tab SRI failures. The manifest uses
  // the same build ID. Retention costs a full build per deploy, not just changed chunks.
  buildId: BUILD_ID,

  compatibilityDate: '2024-07-28',
  build: {
    transpile: ['vue-toastification'],
  },
  routeRules: {
    '/api/v1/docs': {
      redirect: { to: '/docs/api/index.html', statusCode: 301 },
    },
    // Keep API docs crawlable but noindex: a robots disallow hides the header and can leave URLs in the index.
    // The rule also covers openapi.yaml.
    '/docs/**': {
      headers: { 'X-Robots-Tag': 'noindex' },
    },
    // Do not add shared HTML caching without auditing SSR personalization and nonce handling.
    // The root locale router is per-user and must never be shared-cached.
    '/': { headers: { 'Cache-Control': 'private, no-store' } },
    // Shared /api responses (announcement, home grid, media by slug, Shirabe definitions) are cached inside their
    // handlers with explicit keys, not by swr route rules: a route rule keys on the full URL, so every junk query
    // string would mint a cache entry. Their swr options still overwrite Cache-Control, so custom headers here would
    // not reach clients; ETag/Last-Modified still allow browser revalidation.
    ...(isDev && {
      '/**': {
        headers: { 'X-Robots-Tag': 'noindex, nofollow' },
      },
    }),
    ...PRIVATE_ROUTE_RULES,
    '/ja/**': { robots: false },
    // Cloudflare rules own HTML edge caching. Fingerprinted static assets can be immutable.
    '/_nuxt/**': {
      headers: {
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    },
    // Build manifests live under buildAssetsDir (/_nuxt/<build>/builds/), not /_nuxt/builds/. Their meta is
    // build-addressed and safely immutable; latest.json is answered for every build, no-cache, by
    // server/plugins/03-latest-build-manifest.ts so open tabs can see a newer deploy.
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
    // Unversioned blog assets need a finite TTL so in-place replacements become visible; immutable is unsafe here.
    '/icons/**': {
      headers: {
        'Cache-Control': 'public, max-age=604800, stale-while-revalidate=86400',
      },
    },
    '/images/**': {
      headers: {
        'Cache-Control': 'public, max-age=604800, stale-while-revalidate=86400',
      },
    },
  },
  // Keep client sourcemaps true unless every chunk URL changes too. Switching to hidden removes sourceMappingURL
  // after Vite hashes filenames: cached bytes retain the old digest while new HTML advertises the new one,
  // so SRI can block hydration. Edge purges cannot clear browser disk caches. Maps are emitted/uploaded either way.
  sourcemap: { client: true },

  nitro: {
    // Read the preset at build time: production passes node_cluster and staging uses node-server.
    // An explicit literal would override NITRO_PRESET; runtime environment changes cannot enable clustering.
    preset: ['node_cluster', 'node-cluster'].includes(process.env.NITRO_PRESET ?? '') ? 'node-cluster' : 'node-server',
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
      output: {
        sourcemapExcludeSources: false,
      },
      onwarn(warning, defaultHandler) {
        if (warning.code === 'THIS_IS_UNDEFINED' || warning.code === 'CIRCULAR_DEPENDENCY') return;
        defaultHandler(warning);
      },
    },
  },
});
