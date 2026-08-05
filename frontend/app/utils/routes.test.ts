import { describe, expect, it } from 'vitest';
import { SUPPORTED_LOCALES } from './i18n';
import { splitLocalePrefix, withLocalePrefix } from './routes';

describe('splitLocalePrefix', () => {
  // The prefixes are derived from SUPPORTED_LOCALES rather than hand-listed, so
  // a locale added there can never go unrecognised here.
  it.each(SUPPORTED_LOCALES)('recognises the /%s prefix', (locale) => {
    expect(splitLocalePrefix(`/${locale}/search/foo`)).toEqual({
      localePrefix: `/${locale}`,
      localizedPath: '/search/foo',
    });
  });

  it('treats a bare locale root as that locale', () => {
    expect(splitLocalePrefix('/en')).toEqual({ localePrefix: '/en', localizedPath: '/' });
  });

  it('leaves unprefixed paths alone', () => {
    expect(splitLocalePrefix('/blog/example')).toEqual({ localePrefix: '', localizedPath: '/blog/example' });
  });

  // /english is not the /en locale.
  it('only matches whole prefix segments', () => {
    expect(splitLocalePrefix('/english')).toEqual({ localePrefix: '', localizedPath: '/english' });
  });
});

describe('withLocalePrefix', () => {
  it('round-trips a split path', () => {
    const { localePrefix, localizedPath } = splitLocalePrefix('/es/media');
    expect(withLocalePrefix(localePrefix, localizedPath)).toBe('/es/media');
  });

  it('keeps the locale root free of a trailing slash', () => {
    expect(withLocalePrefix('/ja', '/')).toBe('/ja');
  });

  it('is a no-op without a prefix', () => {
    expect(withLocalePrefix('', '/media')).toBe('/media');
  });
});
