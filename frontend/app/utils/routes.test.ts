import { describe, expect, it } from 'vitest';
import { SUPPORTED_LOCALES } from './i18n';
import {
  SEARCH_QUERY_MAX_LENGTH,
  buildMediaPath,
  buildMediaSearchPath,
  canonicalPath,
  decodeSearchQuery,
  isJunkSearchQuery,
  overEscapedSearchQuery,
  queryAndHash,
  mediaBrowsePath,
  searchScopeQuery,
  splitLocalePrefix,
  withLocalePrefix,
} from './routes';

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

describe('decodeSearchQuery', () => {
  it('decodes the raw param exactly once', () => {
    // The router does not decode this param, so `%2541` is text meaning `%41`,
    // not text meaning `A`. Decoding twice was how the page read its own query.
    expect(decodeSearchQuery('%E8%AD%B2')).toBe('譲');
    expect(decodeSearchQuery('%2541')).toBe('%41');
  });

  // Each of these threw a URIError straight out of page setup, which Nuxt
  // answered with `{"statusCode":500,"message":"URI malformed"}`.
  it.each(['%E8%AD', '%C0%80', '%25E8%AD%B2', '%'])('survives the malformed escape %s', (raw) => {
    expect(() => decodeSearchQuery(raw)).not.toThrow();
    expect(decodeSearchQuery(raw)).toBe(raw);
  });
});

describe('isJunkSearchQuery', () => {
  it('keeps queries a reader could have typed', () => {
    expect(isJunkSearchQuery('%E8%AD%B2')).toBe(false);
    expect(isJunkSearchQuery('%E5%BD%BC%E5%A5%B3')).toBe(false);
    // A literal percent survives: `100%` is a search, not a broken escape.
    expect(isJunkSearchQuery('100%25')).toBe(false);
  });

  it('rejects a query that does not decode', () => {
    expect(isJunkSearchQuery('%E8%AD')).toBe(true);
    expect(isJunkSearchQuery('%C0%80')).toBe(true);
  });

  it('rejects a URL fed in as a search term', () => {
    // The shape the canonical loop minted, shortened.
    expect(isJunkSearchQuery('%2Fen%2Fsearch%2F%2525E8')).toBe(true);
  });

  it('rejects a query the backend would reject anyway', () => {
    expect(isJunkSearchQuery('あ'.repeat(SEARCH_QUERY_MAX_LENGTH))).toBe(false);
    expect(isJunkSearchQuery('あ'.repeat(SEARCH_QUERY_MAX_LENGTH + 1))).toBe(true);
  });
});

describe('queryAndHash', () => {
  it('carries a query across', () => {
    expect(queryAndHash('/en/search/x?media=abc&episode=3')).toBe('?media=abc&episode=3');
  });

  it('carries a hash with no query', () => {
    expect(queryAndHash('/en/media#top')).toBe('#top');
  });

  it('carries both, in order', () => {
    expect(queryAndHash('/en/search/x?sort=new#results')).toBe('?sort=new#results');
  });

  it('is empty when there is neither', () => {
    expect(queryAndHash('/en/search/x')).toBe('');
  });

  it('does not re-encode what it carries', () => {
    // Rebuilding this from `route.query` would re-encode it, which is the exact
    // family of bugs the switcher is being moved off the i18n module to avoid.
    expect(queryAndHash('/en/search/x?q=%E6%95%B0%E5%8D%81')).toBe('?q=%E6%95%B0%E5%8D%81');
  });
});

describe('locale switch path composition', () => {
  // Mirrors `useLocaleSwitchPath`, which cannot run outside a Nuxt app.
  const switchTo = (routePath: string, queryParam: string | undefined, fullPath: string, locale: string) => {
    const path = canonicalPath(routePath, queryParam);
    const { localizedPath } = splitLocalePrefix(path);
    return `${withLocalePrefix(`/${locale}`, localizedPath)}${queryAndHash(fullPath)}`;
  };

  it('does not deepen the encoding of a search page', () => {
    // The bug: `route.path` is a layer deeper than the requested URL, so the
    // module's switcher advertised `%2525E8` from a page reached as `%25E8`.
    expect(switchTo('/en/search/%2525E8', '%25E8', '/en/search/%2525E8', 'es')).toBe('/es/search/%25E8');
  });

  it('is a fixed point on an ordinary search', () => {
    const raw = encodeURIComponent('数十');
    expect(switchTo(`/en/search/${raw}`, raw, `/en/search/${raw}`, 'en')).toBe(`/en/search/${raw}`);
  });

  it('keeps the reader standing where they were', () => {
    // The whole query, not the canonical subset: `sort` and `cursor` are dropped
    // from a canonical URL on purpose, but a reader switching language mid-search
    // must not be thrown back to the first page of a different ordering.
    expect(switchTo('/en/search/x', 'x', '/en/search/x?media=abc&sort=new&cursor=99', 'ja')).toBe(
      '/ja/search/x?media=abc&sort=new&cursor=99',
    );
  });

  it('switches locale on an ordinary page', () => {
    expect(switchTo('/en/media', undefined, '/en/media', 'es')).toBe('/es/media');
  });
});

describe('overEscapedSearchQuery', () => {
  it('leaves an ordinarily encoded query alone', () => {
    expect(overEscapedSearchQuery('%E8%AD%B2')).toBeNull();
    expect(overEscapedSearchQuery('%E6%95%B0%E5%8D%81')).toBeNull();
    expect(overEscapedSearchQuery('hello')).toBeNull();
  });

  it('unwraps the exact shape production was serving', () => {
    // Fetched live on 2026-08-16: this returned 200 and emitted three locale
    // links one layer deeper, which is what kept the family breeding.
    expect(overEscapedSearchQuery('%25E6%2595%25B0%25E5%258D%2581')).toBe('数十');
  });

  it('unwraps however many layers have accumulated', () => {
    // The URL that surfaced the original bug had 68 wrapped around 譲渡.
    let raw = encodeURIComponent('譲渡');
    for (let i = 0; i < 20; i += 1) raw = encodeURIComponent(raw);

    expect(overEscapedSearchQuery(raw)).toBe('譲渡');
  });

  it('does not mistake a literal percent for over-escaping', () => {
    // `100%25` decodes to `100%`, and decoding that throws -- one round, so it
    // is an ordinary search for "100%" and must be left alone.
    expect(overEscapedSearchQuery('100%25')).toBeNull();
    // `%25E6` decodes to `%E6`, an incomplete UTF-8 sequence that throws.
    expect(overEscapedSearchQuery('%25E6')).toBeNull();
  });

  it('terminates on input designed to keep unwrapping', () => {
    let raw = 'x';
    for (let i = 0; i < 200; i += 1) raw = encodeURIComponent(raw);

    expect(() => overEscapedSearchQuery(raw)).not.toThrow();
  });

  it('reports the fully decoded text even when it is junk, so one hop is enough', () => {
    // A path-shaped query buried under layers: the middleware asks the junk
    // predicate about THIS value rather than the raw segment, and sends it
    // straight to /search instead of collapsing the escaping first and only
    // discovering the `/` on the next request.
    const buried = encodeURIComponent(encodeURIComponent(encodeURIComponent('/en/search/x')));

    expect(overEscapedSearchQuery(buried)).toBe('/en/search/x');
  });
});

describe('buildMediaSearchPath', () => {
  it('browses the title when no search is behind it', () => {
    expect(buildMediaSearchPath('abc123')).toBe('/search?media=abc123');
    expect(buildMediaSearchPath('abc123', 3)).toBe('/search?media=abc123&episode=3');
  });

  // The bug this exists for: from /search/食べる, filtering by title used to land
  // on /search?media=…, throwing the reader's query away.
  it('keeps the search when one is', () => {
    expect(buildMediaSearchPath('abc123', null, '食べる')).toBe('/search/%E9%A3%9F%E3%81%B9%E3%82%8B?media=abc123');
    expect(buildMediaSearchPath('abc123', 3, '食べる')).toBe(
      '/search/%E9%A3%9F%E3%81%B9%E3%82%8B?media=abc123&episode=3',
    );
  });

  // An empty query is no query: `/search/?media=` would render the same page
  // through a second URL that the canonical does not point at.
  it('treats an empty query as none', () => {
    expect(buildMediaSearchPath('abc123', null, '')).toBe('/search?media=abc123');
  });
});

describe('buildMediaPath', () => {
  it('addresses a title by slug', () => {
    expect(buildMediaPath('steins-gate')).toBe('/media/steins-gate');
    expect(buildMediaPath('steins-gate', 3)).toBe('/media/steins-gate?episode=3');
  });

  // Slugs are generated from romaji names, so they are ASCII in practice -- but
  // the path segment is still encoded, because a slug that ever picked up a
  // stray character must not be able to break out of its own segment.
  it('encodes the segment', () => {
    expect(buildMediaPath('a/b')).toBe('/media/a%2Fb');
  });

  it('omits an empty episode rather than writing a bare parameter', () => {
    expect(buildMediaPath('steins-gate', null)).toBe('/media/steins-gate');
    expect(buildMediaPath('steins-gate', '')).toBe('/media/steins-gate');
  });
});

describe('mediaBrowsePath', () => {
  it('prefers the readable URL', () => {
    expect(mediaBrowsePath({ publicId: 'abc123', slug: 'steins-gate' })).toBe('/media/steins-gate');
    expect(mediaBrowsePath({ publicId: 'abc123', slug: 'steins-gate' }, 3)).toBe('/media/steins-gate?episode=3');
  });

  // A link must never dead-end because a payload predates slugs: the old filter
  // URL still renders, and 301s to the canonical one.
  it('falls back to the filter URL without a slug', () => {
    expect(mediaBrowsePath({ publicId: 'abc123' })).toBe('/search?media=abc123');
    expect(mediaBrowsePath({ publicId: 'abc123', slug: null }, 3)).toBe('/search?media=abc123&episode=3');
  });
});

describe('searchScopeQuery', () => {
  it('keeps where the reader is searching', () => {
    expect(searchScopeQuery({ media: 'abc123', episode: '3', category: 'anime', sort: 'random' })).toEqual({
      media: 'abc123',
      episode: '3',
      category: 'anime',
      sort: 'random',
    });
  });

  it('keeps the legacy spellings, which only SSR rewrites', () => {
    expect(searchScopeQuery({ mediaId: 'abc123', episodeId: '3' })).toEqual({ mediaId: 'abc123', episodeId: '3' });
  });

  // The allowlist earning its keep: `?uuid=` pins the page to one sentence, and
  // carrying it into the next search would pin that one too.
  it('drops everything that is not scope', () => {
    expect(searchScopeQuery({ media: 'abc123', uuid: 'seg1', hideLangs: 'en', query: '学校' })).toEqual({
      media: 'abc123',
    });
  });

  it('treats an absent scope as no scope', () => {
    expect(searchScopeQuery({})).toEqual({});
    expect(searchScopeQuery(undefined)).toEqual({});
    // `?media=` with nothing after it is not a filter -- same rule as `getStringQueryValue`.
    expect(searchScopeQuery({ media: '' })).toEqual({});
  });
});

describe('canonicalPath', () => {
  it('leaves routes without a search query alone', () => {
    expect(canonicalPath('/en/sentence/gFH5xlsT--zr', undefined)).toBe('/en/sentence/gFH5xlsT--zr');
    expect(canonicalPath('/es/search', undefined)).toBe('/es/search');
  });

  it('undoes the extra layer the router adds to route.path', () => {
    // Requested /en/search/%25E8; `route.path` reads it back one layer deeper.
    expect(canonicalPath('/en/search/%2525E8', '%25E8')).toBe('/en/search/%25E8');
  });

  // The property that actually stops the loop: feed the output back in as the
  // next request and nothing new is minted. Before this, each pass added a
  // layer and prod grew 12 bytes a hop with no ceiling.
  it.each(['%E8%AD%B2', '%25E8', '100%25', 'Tiny'])('is a fixed point for %s', (raw) => {
    const first = canonicalPath(`/en/search/${encodeURIComponent(raw)}`, raw);
    const nextRawParam = first.slice('/en/search/'.length);
    expect(canonicalPath(`/en/search/${encodeURIComponent(nextRawParam)}`, nextRawParam)).toBe(first);
  });

  it('keeps the locale it was asked about', () => {
    expect(canonicalPath('/ja/search/%2525E8', '%25E8')).toBe('/ja/search/%25E8');
  });
});
