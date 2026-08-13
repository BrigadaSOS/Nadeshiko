import { readFileSync } from 'node:fs';
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
});
