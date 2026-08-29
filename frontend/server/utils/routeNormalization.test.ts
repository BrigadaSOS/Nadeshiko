import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { LOCALES, normalizeRoute } from '~~/route-normalization.mjs';

/**
 * `route-normalization.mjs` cannot import nuxt.config.ts -- it is loaded by
 * `instrumentation.mjs` before Nuxt exists, and the config calls
 * defineNuxtConfig -- so its locale list is a hand-copied duplicate. That is
 * the failure this file exists to catch: a locale added to nuxt.config.ts and
 * forgotten here does not throw, it just sends every request for that locale
 * to `/__other`, which is exactly the bug the locale handling was added to fix.
 */
function localesFromNuxtConfig(): string[] {
  const source = readFileSync(fileURLToPath(new URL('../../nuxt.config.ts', import.meta.url)), 'utf8');
  const i18nStart = source.indexOf('  i18n: {');
  expect(i18nStart, 'i18n block not found in nuxt.config.ts').toBeGreaterThan(-1);

  const localesStart = source.indexOf('locales: [', i18nStart);
  const localesEnd = source.indexOf('],', localesStart);
  expect(localesStart, 'i18n.locales not found in nuxt.config.ts').toBeGreaterThan(-1);
  expect(localesEnd).toBeGreaterThan(localesStart);

  const block = source.slice(localesStart, localesEnd);
  return [...block.matchAll(/\bcode:\s*'([^']+)'/g)].map((m) => m[1] as string);
}

describe('normalizeRoute locales', () => {
  it('stays in sync with the locales configured in nuxt.config.ts', () => {
    const configured = localesFromNuxtConfig();

    // Guards the extraction itself: if the regex ever silently matches nothing
    // the comparison below would pass against an empty set.
    expect(configured.length).toBeGreaterThan(0);
    expect(configured).toContain('en');

    expect([...LOCALES].sort()).toEqual([...configured].sort());
  });

  it('templates every configured locale rather than bucketing it', () => {
    for (const locale of localesFromNuxtConfig()) {
      expect(normalizeRoute(`/${locale}/sentence/gFH5xlsT--zr`)).toBe('/:locale/sentence/:id');
      expect(normalizeRoute(`/${locale}`)).toBe('/:locale');
    }
  });
});

describe('normalizeRoute', () => {
  it('templates ids regardless of case, which the mixed-case rule used to miss', () => {
    // Single-case public ids leaked through as raw label values before.
    expect(normalizeRoute('/v1/media/segments/-OFOANT699SJ')).toBe('/v1/media/segments/:id');
    expect(normalizeRoute('/v1/media/segments/-hiojjfbx73y')).toBe('/v1/media/segments/:id');
    expect(normalizeRoute('/v1/media/segments/gFH5xlsT--zr')).toBe('/v1/media/segments/:id');
  });

  it('collapses media titles onto one series, whatever the slug looks like', () => {
    // A slug carries no digit and no uppercase, so `isIdSegment` declines to
    // template it and each title used to be its own label -- 236 idle series in
    // a day. `86` and `re-zero-...` are the two halves of the inconsistency
    // this closes: one was templated by the fallback, the other was not.
    expect(normalizeRoute('/en/media/jujutsu-kaisen')).toBe('/:locale/media/:id');
    expect(normalizeRoute('/es/media/spy-family')).toBe('/:locale/media/:id');
    expect(normalizeRoute('/ja/media/re-zero-kara-hajimeru-isekai-seikatsu')).toBe('/:locale/media/:id');
    expect(normalizeRoute('/en/media/86')).toBe('/:locale/media/:id');
    expect(normalizeRoute('/en/media/12')).toBe('/:locale/media/:id');
  });

  it('leaves the media index and the API paths beside it alone', () => {
    // The pattern is anchored to a single segment, so nothing deeper than
    // `/media/<slug>` is swallowed by it.
    expect(normalizeRoute('/en/media')).toBe('/:locale/media');
    expect(normalizeRoute('/v1/media')).toBe('/v1/media');
    expect(normalizeRoute('/v1/media/segments/gFH5xlsT--zr')).toBe('/v1/media/segments/:id');
    expect(normalizeRoute('/v1/media/segments/-OFOANT699SJ/context')).toBe('/v1/media/segments/:id/context');
  });

  it('does not mistake real path words for ids', () => {
    expect(normalizeRoute('/v1/collections')).toBe('/v1/collections');
    expect(normalizeRoute('/v1/stats/covered-words')).toBe('/v1/stats/covered-words');
    expect(normalizeRoute('/v1/user/preferences')).toBe('/v1/user/preferences');
  });

  it('buckets only genuinely unrouted paths', () => {
    // `de` is not a configured locale: the app 302s these to /en/de/... and
    // they dead-end, so they are not an endpoint and must not merge into one.
    expect(normalizeRoute('/de/sentence/xyz12345')).toBe('/__other');
    expect(normalizeRoute('/en/de/sentence/xyz12345')).toBe('/__other');
    expect(normalizeRoute('/totally/bogus')).toBe('/__other');
  });

  it('keeps the signed-in area out of the bucket, locale prefix and all', () => {
    expect(normalizeRoute('/user')).toBe('/user');
    expect(normalizeRoute('/en/user/activity')).toBe('/:locale/user/activity');
    expect(normalizeRoute('/ja/user/collections')).toBe('/:locale/user/collections');
    expect(normalizeRoute('/es/user/admin/reports')).toBe('/:locale/user/admin/reports');

    // `/user` and `/settings` are `[...slug]` catch-alls, so an unlisted page
    // under them is served, not 404ed. It should cost one shared series.
    expect(normalizeRoute('/en/user/not-a-real-page')).toBe('/:locale/user/:slug');
    expect(normalizeRoute('/settings/anything/at/all')).toBe('/settings/:slug');
  });
});

/**
 * STATIC_PAGES is a hand-copied duplicate of the static routes in app/pages,
 * for the same reason LOCALES is one: this module is loaded before Nuxt exists
 * and cannot ask the router what it serves. That makes it the same silent
 * failure -- a page added under app/pages and forgotten here does not throw, it
 * just lands in `/__other`, which is the bug that hid the whole signed-in area
 * until an endpoint list with one row in it gave the game away.
 */
function staticRoutesFromPages(): string[] {
  const pagesDir = fileURLToPath(new URL('../../app/pages', import.meta.url));

  return (
    readdirSync(pagesDir, { recursive: true, encoding: 'utf8' })
      .filter((entry) => entry.endsWith('.vue'))
      .map((entry) => `/${entry.replace(/\.vue$/, '').replace(/\/?index$/, '')}`)
      // Dynamic segments are ROUTE_PATTERNS' job, asserted separately above.
      .filter((route) => !route.includes('['))
      .map((route) => (route === '/' ? route : route.replace(/\/$/, '')))
  );
}

describe('normalizeRoute page coverage', () => {
  it('templates every static page in app/pages as itself', () => {
    const routes = staticRoutesFromPages();

    // Guards the extraction: an empty list would make the loop below vacuous.
    expect(routes.length).toBeGreaterThan(5);
    expect(routes).toContain('/');
    expect(routes).toContain('/user/activity');

    for (const route of routes) {
      expect(normalizeRoute(route), `${route} is served by app/pages but not templated`).toBe(route);
    }
  });
});
