import { readFileSync } from 'node:fs';
import { env } from './config/env';
import { INDEXED_LOCALES as APP_INDEXED_LOCALES } from './app/utils/i18n';
import { PRIVATE_PATH_SEGMENTS } from './shared/utils/privatePaths';

const isDev = env.NUXT_PUBLIC_ENVIRONMENT === 'development';
// Analytics ship in production only. Everywhere else the SDK just fails against
// CSP and fills the console with noise, and any event it did get through would
// land in the same project as real traffic. App code reaches for `posthog-js`
// directly and guards on `posthog.__loaded`, so leaving the module out simply
// makes every capture a no-op.
const isProd = env.NUXT_PUBLIC_ENVIRONMENT === 'production';
// Not `process.dev`: that is injected into app code, not into this file, which
// Nuxt evaluates in plain Node. There it is just a missing property -- undefined,
// no error -- so every `process.dev` test here silently took its production
// branch and the dev server was served the production CSP.
const isLocal = env.NUXT_PUBLIC_ENVIRONMENT === 'local';
const SITE_URL = isDev ? 'https://stg.nadeshiko.co' : 'https://nadeshiko.co';

const CDN_ORIGIN = 'https://cdn.nadeshiko.co';

// Shirabe serves the headword pronunciation clips the word card plays. The URL
// arrives inside the lookup response (`word.pitch[].audioUrl`), so it is not
// something this app constructs and cannot be routed through our own CDN
// without proxying every clip. Media only -- nothing else is loaded from there,
// and a CSP entry that covers more than it needs is one nobody can safely
// narrow later.
const SHIRABE_CDN_ORIGIN = 'https://cdn.shirabe.org';
const POSTHOG_ORIGIN = 'https://t.nadeshiko.co';
const POSTHOG_PUBLIC_KEY = 'phc_vLnds6vZY3nKs6ZenhLnxSHTbYYH4EdS8zJ8mrBvHtjD';
// Where browsers post CSP violations. Sent through our own PostHog proxy rather
// than posthog.com so content blockers don't silently swallow the reports, and
// `/report/` keeps its trailing slash -- PostHog drops the report without it.
// Reports bypass `connect-src`, so the endpoint needs no CSP allowance.
const CSP_REPORT_URI = `${POSTHOG_ORIGIN}/report/?token=${POSTHOG_PUBLIC_KEY}`;
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
  '/changelog',
  '/stats',
  '/stats/words',
];
const SITEMAP_STATIC_URLS_EN = ['/en', ...SITEMAP_STATIC_PATHS.map((path) => `/en${path}`)];
const SITEMAP_STATIC_URLS_ES = ['/es', ...SITEMAP_STATIC_PATHS.map((path) => `/es${path}`)];

// The locales robots is given rules for. `ja` is disallowed wholesale below, so
// only the two indexed locales need per-path entries. Imported rather than
// restated: `plugins/canonical.ts` needs the same list to decide which hreflang
// alternates it may advertise, and the two disagreeing is how `/ja` ended up
// named as an indexable alternate of pages that are `robots: false`.
const INDEXED_LOCALES = APP_INDEXED_LOCALES;

// Both spellings of every private area, in both indexed locales, from the one
// list in shared/utils/privatePaths.ts. This used to be twenty hand-written
// lines, which is how `/settings` and `/reports` ended up disallowed here but
// missing from the `robots: false` route rules further down -- the two lists
// were never read side by side.
const PRIVATE_DISALLOW = INDEXED_LOCALES.flatMap((locale) =>
  PRIVATE_PATH_SEGMENTS.flatMap((segment) => [`/${locale}${segment}`, `/${locale}${segment}/`]),
);

// The matching route rules, from the same source, so a segment added to the list
// is both de-indexed and kept out of the shared cache without a second edit.
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
      include: ['@unhead/vue', '@grafana/faro-web-sdk', '@grafana/faro-web-tracing'],
    },
  },
  app: {
    head: {
      // The theme class lives on <html>, not on a wrapper inside the app.
      //
      // Tailwind is `darkMode: ['class']`, so every `dark:` utility needs a
      // `.dark` ANCESTOR. Modals and the word card `<Teleport to="body">`, which
      // lands them as siblings of the layout -- so while the class sat on the
      // layout div they were outside it, every `dark:` variant on their panels
      // was inert, and a panel written as `bg-white dark:bg-modal-background`
      // rendered white. `.dark` is also where `--modal-background` and friends
      // are defined, so an unprefixed `bg-modal-background` resolved to nothing
      // at all. On <html> nothing can be teleported out from under it.
      //
      // Set here rather than in app.vue's `useHead` so it is server-rendered
      // with the document and there is no light flash before hydration. The
      // site is dark-only anyway: `body` is a hardcoded #1d1d1d in
      // assets/css/tailwind.css and `color-scheme` is `dark` below.
      htmlAttrs: { class: 'dark' },
      meta: [
        {
          name: 'description',
          content:
            'Search over 1 million Japanese sentences with English and Spanish translations from a wide variety of anime and J-dramas.',
        },
        { property: 'og:type', content: 'website' },
        // No `og:image:width`/`:height` here, deliberately. They lived here as
        // 1200x630 -- the default card's size -- and every page that overrode
        // `og:image` with a real asset inherited them: clip stills (960x540) and
        // media banners (1200x391-400) were both advertised at a size they have
        // never been, and crawlers lay the card out from the declaration. The
        // pair now travels WITH the image it describes, via `buildOgImageTags`
        // in app/utils/metaTags.ts. Anything set globally here cannot.
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
    nadeshikoApiKey: env.NUXT_NADESHIKO_API_KEY,
    // Shirabe parses the corpus and serves the definitions behind every word.
    // Server-side only, deliberately: it is a service key of ours, and anything
    // under `public` below is shipped to the browser.
    shirabeApiKey: env.NUXT_SHIRABE_API_KEY,
    shirabeApiBase: env.NUXT_SHIRABE_API_BASE || 'https://shirabe.org',
    // Optional fast path to Shirabe over the tailnet, skipping the round trip
    // out to Cloudflare and back for two boxes in the same city. Unset means
    // "public host only"; the lookup route falls back to it either way, so this
    // only ever changes latency.
    shirabeApiDirect: env.NUXT_SHIRABE_API_DIRECT || '',
    internalProxySecret: env.NUXT_INTERNAL_PROXY_SECRET,
    backendInternalUrl: env.NUXT_BACKEND_INTERNAL_URL,
    backendHostHeader: env.NUXT_BACKEND_HOST_HEADER,
    mediaFilesPath: env.NUXT_MEDIA_FILES_PATH,
    // Keeps the previous builds' chunks servable, so a deploy does not 404 the
    // page a reader already has open. Read at startup by
    // server/plugins/03-asset-archive.ts; unset means the archive stays off.
    assetArchiveDir: env.NUXT_ASSET_ARCHIVE_DIR,
    assetArchiveDays: env.NUXT_ASSET_ARCHIVE_DAYS,
    // Read by the middleware that emits `Reporting-Endpoints`, so the endpoint
    // is declared next to the `report-to` directive that names it. Absent outside
    // production, which the middleware already treats as "emit no header".
    ...(isProd && { cspReportUri: `${CSP_REPORT_URI}&type=report-to` }),
    public: {
      appVersion: frontendPackageJson.version,
      environment: env.NUXT_PUBLIC_ENVIRONMENT,
      // Whether word lookups are configured at all. The KEY stays server-side;
      // this is only the boolean, so the browser can leave the feature alone
      // instead of firing a doomed request on every hover and cacheing the
      // failure. Without it the card still shows what the token itself knows:
      // the word, its reading, and what the form is doing.
      shirabeLookups: Boolean(env.NUXT_SHIRABE_API_KEY),
      faroUrl: env.NUXT_PUBLIC_FARO_URL || '',
      faroAppName: env.NUXT_PUBLIC_FARO_APP_NAME || '',
    },
  },
  // Only .vue files are components. The default scan also picks up .ts, which
  // registered the helper modules colocated with their components (activityHelpers,
  // reportHelpers, segmentEditState) as components -- they export no component, so
  // the entries were dead weight in the auto-import namespace and a name there could
  // shadow a real component. Colocation stays; the phantom registrations go.
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
  // Only when `@posthog/nuxt` is absent, so the shim can never shadow the real
  // `usePostHog()` in production.
  ...(isProd ? {} : { imports: { dirs: ['shims/posthog'] } }),
  security: {
    // Per-request nonces, so `script-src` can drop 'unsafe-inline' below.
    // nuxt-security stamps the nonce onto the scripts Nuxt renders (the SSR
    // payload especially); scripts loaded from the allow-listed origins are
    // matched by host and need no nonce. Requires SSR per request -- if a page
    // is ever prerendered or shared-cached, its baked-in nonce will not match
    // the header and its inline scripts will be blocked.
    nonce: true,
    headers: {
      referrerPolicy: 'strict-origin-when-cross-origin',
      contentSecurityPolicy: isLocal
        ? false
        : {
            'default-src': ["'self'"],
            'script-src': [
              "'self'",
              // Not 'unsafe-inline': a nonce is present, so browsers ignore
              // 'unsafe-inline' anyway, and inline scripts are trusted only when
              // they carry this request's nonce.
              "'nonce-{{nonce}}'",
              "'wasm-unsafe-eval'",
              POSTHOG_ORIGIN,
              CF_INSIGHTS_ORIGIN,
              'https://www.youtube.com',
            ],
            'style-src': ["'self'", "'unsafe-inline'"],
            'img-src': ["'self'", 'data:', CDN_ORIGIN],
            'font-src': ["'self'"],
            'connect-src': [
              "'self'",
              CDN_ORIGIN,
              POSTHOG_ORIGIN,
              CF_INSIGHTS_ORIGIN,
              FARO_ORIGIN,

              'http://127.0.0.1:*',
              'http://localhost:*',
            ],
            'worker-src': ["'self'", 'blob:'],
            'media-src': ["'self'", 'blob:', CDN_ORIGIN, SHIRABE_CDN_ORIGIN],
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
            // Both, deliberately: `report-to` is what Chrome still honours, and
            // `report-uri` is all Firefox and Safari understand. `report-to`
            // names the endpoint declared in the `Reporting-Endpoints` header
            // (server/middleware/98-html-response-headers.ts).
            //
            // Production only, like the SDK: the endpoint is a PostHog project,
            // and staging violations reported into it are indistinguishable from
            // real ones. On staging the browser console is the signal instead.
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
      },
      serverConfig: {
        enableExceptionAutocapture: false,
      },
      /**
       * ONLY SAFE BECAUSE OF `modules/sri-after-asset-mutations.ts`. Read that
       * file before touching this one.
       *
       * Uploading source maps runs `posthog-cli sourcemap inject`, which
       * REWRITES every built JS file in `.output/public` to carry a chunk id
       * ("injecting selection: [.output/public]", "found 76 pairs"). It runs at
       * `nitro:build:public-assets`; nuxt-security computes the Subresource
       * Integrity digests at `nitro:build:before`, which fires EARLIER. Enabling
       * this without addressing that took production down on 2026-08-13: 37 of
       * 41 scripts blocked, the page served from SSR and never hydrated, every
       * click inert, rolled back after ~13 minutes.
       *
       * There is no way to upload without injecting -- `enabled` governs both --
       * so the ordering is what had to be fixed, and it was: the digests are now
       * recomputed from the finished output after every mutation. Verified with
       * upload ON: 93 assets match, and a real render served 42 of 42
       * subresources whose `integrity` matched their bytes.
       *
       * The module is gated on `isProd`, so staging cannot exercise this path at
       * all -- which is why it was production that found out. `verify-sri` runs
       * inside the image build instead and fails it if any asset stops matching
       * its digest, so a regression here breaks the BUILD, not the site.
       */
      sourcemaps: {
        enabled: Boolean(process.env.POSTHOG_CLI_API_KEY),
        projectId: '372788',
        // `?? ''` because the module types this as a required string and
        // `process.env` is not: the key is a Docker build arg, absent from every
        // context that only typechecks. It typechecks WITHOUT this on a machine
        // that has `frontend/.env`, which is what let it reach CI -- Nuxt narrows
        // `process.env` from the keys it finds there, so the local build and the
        // runner disagree about the type of the same expression. Never used
        // empty: `enabled` above is false in exactly the case this covers.
        personalApiKey: process.env.POSTHOG_CLI_API_KEY ?? '',
      },
    },
  }),
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
            disallow: ['/ja', '/ja/', ...PRIVATE_DISALLOW, '/api/', '/v1/', '/_nuxt/'],
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
    // `language`, not `iso`: v10 renamed the field, and it reads a missing
    // `language` as "no ISO code" and silently emits no hreflang alternates at
    // all -- the warning is the only signal. Keep these in sync with the
    // hreflang values Google expects.
    locales: [
      {
        code: 'en',
        language: 'en',
        name: 'English',
      },
      {
        code: 'es',
        language: 'es',
        name: 'Español',
      },
      {
        code: 'ja',
        language: 'ja',
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
    // Make the module's own `/_i18n/:hash/:locale/messages.json` route cacheable. Every
    // browser asks for it, and until these two knobs were set it answered with
    // `Cache-Control: max-age=-1` -- so nothing ever cached it and every navigation
    // asked again. That is what put it at 75% of all SSR requests during the #484
    // window, 275k hits in three hours.
    //
    // Worth being precise about what it is NOT, because #484 guessed wrong and the
    // guess is plausible: this route does not serve our messages. They come from
    // i18n.config.ts, which is bundled into the app, so the server route has no file
    // loaders to read and answers `{"en":{}}` -- nine bytes, verified against prod. The
    // cost was never bytes or JSON work, only the round trip, and the round trip is
    // what a cacheable answer removes.
    //
    // `cacheLifetime` is the gate, and its default is the trap: the module reads it as
    // -1, caching off, unless some locale declares a `file:` -- and ours are inline.
    // `httpCacheDuration` is what the handler then writes into Cache-Control, and its
    // own default is 10 SECONDS, short enough to be worth almost nothing on its own.
    //
    // A day is safe because the `:hash` segment is a content hash per locale, so these
    // URLs are immutable and a deploy is the only invalidation event -- the same reason
    // /api/shirabe/** below gets 86400.
    //
    // Both live under `experimental`, so this is the one part of the config a minor
    // @nuxtjs/i18n bump can rename out from under us (pinned ^10.6.0). If the messages
    // route ever shows up hot in the SSR logs again, check these names first.
    experimental: {
      cacheLifetime: 60 * 60 * 24,
      httpCacheDuration: 60 * 60 * 24,
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
    // Caching policy: pages without an explicit rule emit no Cache-Control header.
    // Cloudflare doesn't cache HTML by default and browsers heuristically cache for
    // the same user only — fine. To make a page edge-cacheable across users, audit
    // it for SSR personalization (logged-in nav, hidden-media filter, content-rating
    // gating, etc.) and only then add a `public, s-maxage=...` rule below.
    //
    // `/` is the per-user locale router (server/middleware/00-locale-router.ts) and
    // must never be shared-cached.
    '/': { headers: { 'Cache-Control': 'private, no-store' } },
    // Word definitions are cached on the server, not just in each browser: that
    // is the difference between Shirabe answering once per word per day and once
    // per word per reader per day, and a page of twenty segments holds a few
    // hundred distinct words.
    //
    // NOT a route rule any more, and the reason is worth knowing before adding
    // one back. A rule keys on the path and applies to everyone, which was right
    // while every reader got the same definitions. A reader who links their
    // Shirabe account now gets theirs -- their dictionaries, in their order -- so
    // a path-keyed entry would let the first such reader fill the shared copy of
    // a word and serve it to everybody else. The handler caches itself instead
    // and a linked reader skips the cache entirely: see
    // server/api/shirabe/words/candidates/[lemma].get.ts.
    // Two more answers that are identical for every visitor, cached for the same
    // reason and on the same mechanism. Both used to be fetched straight from a
    // component, which meant a backend round trip per render of a page whose
    // content had not changed since the last one.
    //
    // No `headers` on these, deliberately, and it is worth knowing why before
    // adding one: Nitro's cached handler *overwrites* `cache-control` on any
    // route with `swr`, to `s-maxage=<maxAge>, stale-while-revalidate`. A
    // `Cache-Control` set here -- or by the handler itself, which is what
    // `/api/shirabe/**` above still tries -- never reaches the client. What it
    // emits instead is fine: `s-maxage` is the shared-cache lifetime, which is
    // the tier that matters, and Nitro attaches an ETag and `Last-Modified` so a
    // browser revalidating costs a 304 rather than a render.
    //
    // The windows differ by how fast a change needs to show. An announcement is
    // usually a maintenance notice, so a minute is about the longest it can sit
    // unseen and still be useful; `swr` keeps serving the old one meanwhile, so
    // the short window costs one background refresh a minute, not a stampede.
    '/api/announcement': { swr: 60 },
    // The home grid changes when media is imported. Five minutes is invisible to
    // a reader and turns the busiest page's only backend call into a rounding
    // error. Safe to share because `/` deliberately skips the hidden-media
    // filter -- the grid is the same list for everyone, signed in or not.
    '/api/home/recent-media': { swr: 300 },
    // Slug -> media, behind every `/media/<slug>` render. Identical for every
    // visitor and changes only when a title is edited or imported. The catalogue
    // index this sits on is cached in-process as well (see
    // `server/utils/mediaSlugIndex.ts`); this tier is what keeps a crawler
    // walking 317 title pages from re-entering the handler for each one.
    '/api/media/by-slug/**': { swr: 3600 },
    // The related-word links under a word page. Identical for every reader and
    // derived from the frequency list, which moves only on a corpus reimport --
    // so a long window, and one that matters: the index behind it is built by
    // paginating the top 5k words, and this tier is what keeps a crawler walking
    // ~19.8k word pages from reaching that build more than once.
    '/api/words/related': { swr: 86400 },
    // Block all indexing on dev environments
    ...(isDev && {
      '/**': {
        headers: { 'X-Robots-Tag': 'noindex, nofollow' },
      },
    }),
    // Private/authenticated areas should never be indexed. Derived, not listed:
    // the hand-written version covered user and admin but had silently fallen
    // behind on settings, reports and collections.
    ...PRIVATE_ROUTE_RULES,
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
    // EXCEPT the app manifest, which is not fingerprinted and is the one file
    // under `/_nuxt/` that must never be stale: `builds/latest.json` is how the
    // client notices a deploy happened at all. The rule above was matching it
    // and promising a year, so a reader's browser answered that check from cache
    // and the client concluded the build had never changed. Nitro's own default
    // for this path is `maxAge: 1` -- the rule above was overriding it.
    //
    // `builds/meta/<build-id>.json` is addressed by build id, so it genuinely is
    // immutable and keeps the long TTL. Declared before the broader rule for
    // readability only; Nitro merges matching rules by specificity, not by
    // order.
    '/_nuxt/builds/meta/**': {
      headers: {
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    },
    '/_nuxt/builds/**': {
      headers: {
        'Cache-Control': 'no-cache',
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
    // Unversioned filenames (`github.svg`, `orange-pi.jpg`), so a week with
    // background revalidation rather than the `immutable` year used above:
    // replacing one of these in place has to become visible eventually.
    // Without a rule they fall through to the zone's 1h browser TTL, which has
    // every reader refetching the same blog images hourly.
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
  /**
   * `true`, NOT `'hidden'`, and the difference is a site-wide outage.
   *
   * `'hidden'` emits the same maps and merely drops the `//# sourceMappingURL=`
   * comment from each chunk -- which sounds free, and is not, because VITE'S
   * CHUNK HASH IS COMPUTED BEFORE THAT COMMENT IS APPENDED. Flipping this
   * setting therefore changes the BYTES of every chunk while leaving every
   * FILENAME identical. Measured on `0KcF1APn.js`, 2026-08-13:
   *
   *   sourcemap: true      360 bytes  sha384-of369LbkPkc...
   *   sourcemap: 'hidden'  323 bytes  sha384-AsFW6+qt...
   *
   * The 37 bytes are the comment. Both builds call the file `0KcF1APn.js`.
   *
   * That breaks the one guarantee everything here rests on: that a content-hashed
   * name identifies exactly one byte sequence forever. `/_nuxt/*` is served
   * `immutable, max-age=31536000`, so a returning reader's browser reuses its
   * cached copy WITHOUT revalidating, while the new HTML carries the new build's
   * `integrity` attribute -- and nuxt-security's SRI then blocks every script on
   * the page. Not a degraded page: a blank one, for anyone who visited before.
   * Nine of the forty chunks on prod's `/en` collided this way.
   *
   * It is also unpurgeable. The deploy purge clears Cloudflare; nothing clears a
   * reader's own disk cache. Staging demonstrated the whole failure on
   * 2026-08-13 -- every chunk blocked, no hydration, the E2E suite timing out on
   * clicks that did nothing.
   *
   * So this stays `true` unless a build ships where every chunk name changes
   * anyway. The maps are emitted either way and `@posthog/nuxt` uploads them
   * either way; all `'hidden'` bought was not advertising a URL that is public
   * regardless.
   */
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
