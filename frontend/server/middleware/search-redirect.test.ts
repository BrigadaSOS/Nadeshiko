import { describe, test, expect, beforeEach, vi } from 'vitest';

/**
 * The permanent redirects that keep every bookmark, inbound link and indexed
 * URL from before the Feb 2026 URL change working.
 *
 * They are load-bearing in a way that is easy to forget: nothing in the app
 * links to these shapes any more, so a break is invisible to anyone developing
 * the site and shows up only as 404s in somebody else's referrer log months
 * later. And the junk-collapsing half is the opposite problem -- it is what
 * stopped 14k requests a day on production, because rendering those paths
 * (even correctly) emitted a fresh set of locale links one escaping layer
 * deeper, which then got crawled.
 *
 * Driven through the real handler with h3's globals stubbed, so the assertions
 * are on the Location header a visitor is actually sent.
 */
let redirects: { location: string; status: number }[] = [];

vi.stubGlobal('defineEventHandler', (fn: unknown) => fn);
vi.stubGlobal('getRequestURL', (event: { url: URL }) => event.url);
vi.stubGlobal('sendRedirect', (_event: unknown, location: string, status: number) => {
  redirects.push({ location, status });
  return location;
});

const handler = (await import('./search-redirect')).default as (event: { url: URL }) => unknown;

/** Runs the middleware against a path and returns where it sent the visitor, if anywhere. */
function visit(path: string) {
  redirects = [];
  handler({ url: new URL(`https://nadeshiko.co${path}`) });
  return redirects[0] ?? null;
}

/** Where the visitor was sent, or null when the middleware passed the request through. */
function locationOf(path: string) {
  return visit(path)?.location ?? null;
}

beforeEach(() => {
  redirects = [];
});

describe('paths this middleware does not own', () => {
  test.each(['/', '/media', '/sentence/abc', '/blog', '/en/media'])('passes %s straight through', (path) => {
    expect(locationOf(path)).toBeNull();
  });

  test('a plain /search landing is left alone', () => {
    expect(locationOf('/search')).toBeNull();
  });

  test('an ordinary search path is left alone', () => {
    expect(locationOf('/search/%E9%A3%9F%E3%81%B9%E3%82%8B')).toBeNull();
  });
});

describe('the old /search/sentence route', () => {
  test('with a query becomes a path-based search', () => {
    expect(locationOf('/search/sentence?query=彼女')).toBe(`/search/${encodeURIComponent('彼女')}`);
  });

  test('without a query becomes the search landing', () => {
    expect(locationOf('/search/sentence')).toBe('/search');
  });

  test('tolerates the trailing slash a crawler will eventually try', () => {
    expect(locationOf('/search/sentence/')).toBe('/search');
  });

  test('keeps the filters that came with it', () => {
    // Dropping them silently changes what the visitor sees, which is worse
    // than a 404 because nobody reports it.
    expect(locationOf('/search/sentence?query=neko&category=anime&sort=RANDOM')).toBe(
      `/search/neko?category=anime&sort=RANDOM`,
    );
  });

  test('keeps the filters when there was no query at all', () => {
    expect(locationOf('/search/sentence?category=anime')).toBe('/search?category=anime');
  });
});

describe('the query-parameter form of search', () => {
  test('becomes a path-based search', () => {
    expect(locationOf('/search?query=neko')).toBe('/search/neko');
  });

  test('keeps the other filters', () => {
    expect(locationOf('/search?query=neko&category=anime')).toBe('/search/neko?category=anime');
  });

  test('an empty query lands on the search page rather than on /search/', () => {
    expect(locationOf('/search?query=')).toBe('/search');
  });
});

describe('individual sentences', () => {
  test('a uuid on the old sentence route becomes a sentence page', () => {
    expect(locationOf('/search/sentence?uuid=abc123')).toBe('/sentence/abc123');
  });

  test('a uuid on the search route becomes a sentence page too', () => {
    expect(locationOf('/search?uuid=abc123')).toBe('/sentence/abc123');
  });

  test('the uuid wins over a query on the same URL', () => {
    // An old link carrying both meant "show me this sentence"; running the
    // search instead would land the visitor somewhere else entirely.
    expect(locationOf('/search?uuid=abc123&query=neko')).toBe('/sentence/abc123?query=neko');
  });
});

describe('media browse', () => {
  test('the old media route becomes /media', () => {
    expect(locationOf('/search/media')).toBe('/media');
  });

  test('with a trailing slash too', () => {
    expect(locationOf('/search/media/')).toBe('/media');
  });

  test('keeps its query', () => {
    expect(locationOf('/search/media?query=steins')).toBe('/media?query=steins');
  });
});

describe('legacy filter parameter names', () => {
  test('mediaId is renamed to media', () => {
    expect(locationOf('/search/neko?mediaId=m-1')).toBe('/search/neko?media=m-1');
  });

  test('episodeId is renamed to episode', () => {
    expect(locationOf('/search/neko?episodeId=3')).toBe('/search/neko?episode=3');
  });

  test('the canonical name wins when a link carries both', () => {
    // Preferring the legacy one would let a stale bookmark override the
    // parameter the current UI wrote.
    expect(locationOf('/search/neko?media=m-new&mediaId=m-old')).toBe('/search/neko?media=m-new');
  });

  test('both are renamed in one hop rather than two', () => {
    expect(locationOf('/search/neko?mediaId=m-1&episodeId=3')).toBe('/search/neko?media=m-1&episode=3');
  });

  test('a path with no legacy names is not redirected to itself', () => {
    // A redirect to the same URL is a loop.
    expect(locationOf('/search/neko?media=m-1')).toBeNull();
  });
});

describe('junk queries', () => {
  test('a path-shaped query collapses onto the search landing', () => {
    expect(locationOf('/search/wp-admin/setup-config.php')).toBe('/search');
  });

  test('an over-long query collapses too', () => {
    // The cap is what the backend accepts; 500 is still inside it.
    expect(locationOf(`/search/${'a'.repeat(501)}`)).toBe('/search');
    expect(locationOf(`/search/${'a'.repeat(500)}`)).toBeNull();
  });

  test('collapsing happens after the legacy routes are read', () => {
    // `/search/sentence` has to be understood as a route before anything reads
    // it as a query, or the compatibility redirect never fires.
    expect(locationOf('/search/sentence?query=neko')).toBe('/search/neko');
  });
});

describe('multiply-escaped queries', () => {
  test('collapse onto the ordinary single encoding', () => {
    // Every render of one of these emitted locale links a layer deeper again,
    // which is how the family grew to 14k requests a day.
    const once = encodeURIComponent('数');
    const twice = encodeURIComponent(once);

    expect(locationOf(`/search/${twice}`)).toBe(`/search/${once}`);
  });

  test('are judged on what they unwrap to, not on how they arrived', () => {
    // A path-shaped query buried under several layers would otherwise read as
    // ordinary here and cost a second hop to collapse.
    const buried = encodeURIComponent(encodeURIComponent('wp-admin/setup-config.php'));

    expect(locationOf(`/search/${buried}`)).toBe('/search');
  });

  test('keep the filters that came with them', () => {
    const twice = encodeURIComponent(encodeURIComponent('数'));

    expect(locationOf(`/search/${twice}?category=anime`)).toBe(`/search/${encodeURIComponent('数')}?category=anime`);
  });
});

describe('locale prefixes', () => {
  test.each(['en', 'es', 'ja'])('a /%s redirect stays in that locale', (locale) => {
    // Dropping the prefix sends a Spanish reader to the English page and, for
    // a crawler, turns one indexed URL into a cross-locale redirect.
    expect(locationOf(`/${locale}/search/sentence?query=neko`)).toBe(`/${locale}/search/neko`);
  });

  test('a localized uuid link keeps its locale', () => {
    expect(locationOf('/es/search?uuid=abc123')).toBe('/es/sentence/abc123');
  });

  test('a localized junk query collapses within its locale', () => {
    expect(locationOf('/ja/search/wp-admin/setup-config.php')).toBe('/ja/search');
  });
});

describe('the status code', () => {
  test.each([
    '/search/sentence?query=neko',
    '/search?uuid=abc',
    '/search/media',
    '/search/wp-admin/setup-config.php',
    '/search/neko?mediaId=m-1',
  ])('%s is a permanent redirect, so it is cached and stops being requested', (path) => {
    // A 302 would leave every one of these being re-requested forever, which
    // for the junk family is the entire cost this exists to remove.
    expect(visit(path)?.status).toBe(301);
  });
});
