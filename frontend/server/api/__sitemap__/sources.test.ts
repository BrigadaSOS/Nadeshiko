import { describe, test, expect, beforeEach, vi } from 'vitest';

/**
 * The two sitemap sources that open the corpus to crawlers.
 *
 * Both exist because the sitemap submitted 320 media pages, 19,784 word searches
 * and eight static URLs -- and not one of the 1.3M sentence permalinks, which
 * are the pages people actually share. They were reachable only by crawling
 * search results, the most expensive thing this site serves.
 *
 * Neither submits the whole corpus, and the sampling rules are the part worth
 * pinning, because every way they go wrong produces a URL that returns HTTP 200
 * with nothing on it -- exactly what these changes were made to stop submitting:
 *
 *   - episode numbers are READ, never counted: they are not 1..n (movies and
 *     specials are 0), so counting invents an episode past the end;
 *   - single-episode titles are skipped, because `?episode=1` on a film is the
 *     page the media source already submits;
 *   - only ACTIVE, SAFE-or-SUGGESTIVE segments, because a hidden one is a
 *     permalink to nothing and a sitemap is an invitation, not an inventory;
 *   - and one unreachable title costs its own URLs, never the whole file.
 */
const handlers: ((event: unknown) => Promise<unknown>)[] = [];
vi.stubGlobal('defineSitemapEventHandler', (handler: (event: unknown) => Promise<unknown>) => {
  handlers.push(handler);
  return handler;
});
vi.stubGlobal('getQuery', (event: { query?: Record<string, unknown> }) => event.query ?? {});

type Media = { publicId: string; slug?: string | null; episodeCount?: number | null; updatedAt?: string | null };
type Episode = { episodeNumber: number };
type Segment = { publicId?: string | null; status: string; contentRating: string };

const catalogue = {
  media: [] as Media[],
  episodes: {} as Record<string, Episode[] | Error>,
  segments: {} as Record<string, Segment[] | Error>,
};

/** An async iterable of `rows`, or one that throws, the way the SDK paginates. */
function paginate<T>(rows: T[] | Error) {
  return (async function* () {
    if (rows instanceof Error) throw rows;
    for (const row of rows) yield row;
  })();
}

/**
 * `take` is the PAGE SIZE, not a limit, and this double keeps it that way.
 *
 * `.paginate()` walks every page: a caller that wants fewer rows has to stop
 * iterating itself. A double that sliced to `take` would silently do the
 * stopping for the code under test, and the caps and `break`s in these handlers
 * -- the only thing keeping one long-running title from crowding out the
 * catalogue -- would be untested and look covered.
 */
vi.stubGlobal('useServerSdk', () => ({
  listMedia: { paginate: () => paginate(catalogue.media) },
  listEpisodes: {
    paginate: ({ mediaPublicId }: { mediaPublicId: string }) => paginate(catalogue.episodes[mediaPublicId] ?? []),
  },
  listSegments: {
    // Keyed by episode as well as title: the handler picks ONE episode, and a
    // double that ignored the number would answer the same for whichever it
    // picked -- so asking for the wrong episode would look correct.
    paginate: ({ mediaPublicId, episodeNumber }: { mediaPublicId: string; episodeNumber: number }) =>
      paginate(catalogue.segments[`${mediaPublicId}:${episodeNumber}`] ?? catalogue.segments[mediaPublicId] ?? []),
  },
}));

// Imported inside the run, not at the top: a static import is hoisted above the
// `stubGlobal` calls, and these modules call `defineSitemapEventHandler` as they
// load.
const episodesSource = () => import('./episodes').then((m) => m.default);
const sentencesSource = () => import('./sentences').then((m) => m.default);

type Url = { loc: string; lastmod?: string; changefreq?: string };

const run = async (source: () => Promise<unknown>, query: Record<string, unknown> = {}) => {
  const handler = (await source()) as (e: unknown) => Promise<Url[]>;
  return (await handler({ query })) ?? [];
};

const locs = (urls: Url[]) => urls.map((url) => url.loc);

const segment = (publicId: string, over: Partial<Segment> = {}): Segment => ({
  publicId,
  status: 'ACTIVE',
  contentRating: 'SAFE',
  ...over,
});

beforeEach(() => {
  catalogue.media = [];
  catalogue.episodes = {};
  catalogue.segments = {};
});

describe('the episode source', () => {
  test('submits one URL per episode the API actually reports', async () => {
    catalogue.media = [{ publicId: 'm1', slug: 'oshi-no-ko', episodeCount: 3 }];
    catalogue.episodes.m1 = [{ episodeNumber: 1 }, { episodeNumber: 2 }, { episodeNumber: 3 }];

    expect(locs(await run(episodesSource))).toEqual([
      '/en/media/oshi-no-ko?episode=1',
      '/en/media/oshi-no-ko?episode=2',
      '/en/media/oshi-no-ko?episode=3',
    ]);
  });

  test('reads episode ZERO rather than counting from one', async () => {
    // The schema says 0 for movies and specials, and a title in the corpus runs
    // 0..12 with `episodeCount` 13. Counting skips its episode 0 and invents an
    // episode 13, which renders an empty page at HTTP 200.
    catalogue.media = [{ publicId: 'm1', slug: 'oshi-no-ko', episodeCount: 2 }];
    catalogue.episodes.m1 = [{ episodeNumber: 0 }, { episodeNumber: 1 }];

    expect(locs(await run(episodesSource))).toEqual([
      '/en/media/oshi-no-ko?episode=0',
      '/en/media/oshi-no-ko?episode=1',
    ]);
  });

  test('skips a single-episode title, whose episode page is its media page', async () => {
    catalogue.media = [{ publicId: 'm1', slug: 'a-film', episodeCount: 1 }];
    catalogue.episodes.m1 = [{ episodeNumber: 1 }];

    expect(await run(episodesSource)).toEqual([]);
  });

  test('skips a title with no episode count at all', async () => {
    catalogue.media = [{ publicId: 'm1', slug: 'unknown', episodeCount: null }];
    catalogue.episodes.m1 = [{ episodeNumber: 1 }];

    expect(await run(episodesSource)).toEqual([]);
  });

  test('skips a title with no slug, which has no readable URL to submit', async () => {
    catalogue.media = [{ publicId: 'm1', slug: null, episodeCount: 5 }];
    catalogue.episodes.m1 = [{ episodeNumber: 1 }];

    expect(await run(episodesSource)).toEqual([]);
  });

  test('carries the title’s own modification time when it has one', async () => {
    catalogue.media = [{ publicId: 'm1', slug: 'a', episodeCount: 2, updatedAt: '2026-08-01T00:00:00Z' }];
    catalogue.episodes.m1 = [{ episodeNumber: 1 }];

    expect((await run(episodesSource))[0]!.lastmod).toBe('2026-08-01T00:00:00Z');
  });

  test('and omits it rather than inventing one', async () => {
    // An inaccurate `lastmod` gets the hint discounted for the whole site.
    catalogue.media = [{ publicId: 'm1', slug: 'a', episodeCount: 2, updatedAt: null }];
    catalogue.episodes.m1 = [{ episodeNumber: 1 }];

    expect((await run(episodesSource))[0]).not.toHaveProperty('lastmod');
  });

  test('one unreachable title costs its own episodes, not the sitemap', async () => {
    // A source that throws returns nothing at all, and a sitemap that silently
    // shrinks to zero is worse than one missing a show.
    catalogue.media = [
      { publicId: 'm1', slug: 'broken', episodeCount: 5 },
      { publicId: 'm2', slug: 'fine', episodeCount: 2 },
    ];
    catalogue.episodes.m1 = new Error('upstream down');
    catalogue.episodes.m2 = [{ episodeNumber: 1 }];

    expect(locs(await run(episodesSource))).toEqual(['/en/media/fine?episode=1']);
  });

  test('submits the Spanish URLs when the Spanish sitemap asks', async () => {
    catalogue.media = [{ publicId: 'm1', slug: 'oshi-no-ko', episodeCount: 2 }];
    catalogue.episodes.m1 = [{ episodeNumber: 1 }];

    expect(locs(await run(episodesSource, { locale: 'es' }))).toEqual(['/es/media/oshi-no-ko?episode=1']);
  });
});

describe('the sentence source', () => {
  test('submits the opening sentences of one episode per title', async () => {
    // A sample proportional to the catalogue, not to the corpus: the whole
    // corpus cannot be paginated on every sitemap build.
    catalogue.media = [{ publicId: 'm1', slug: 'a' }];
    catalogue.episodes.m1 = [{ episodeNumber: 4 }];
    catalogue.segments['m1:4'] = [segment('seg-1'), segment('seg-2')];

    expect(locs(await run(sentencesSource))).toEqual(['/en/sentence/seg-1', '/en/sentence/seg-2']);
  });

  test('takes them from the FIRST episode reported, not the last', async () => {
    // One episode per title is the sample; which one has to be the one the
    // handler said it was asking for, or the cap is spent on a different
    // episode than the lookup.
    catalogue.media = [{ publicId: 'm1' }];
    catalogue.episodes.m1 = [{ episodeNumber: 4 }, { episodeNumber: 5 }];
    catalogue.segments['m1:4'] = [segment('from-first')];
    catalogue.segments['m1:5'] = [segment('from-last')];

    expect(locs(await run(sentencesSource))).toEqual(['/en/sentence/from-first']);
  });

  test('uses the FIRST episode the API reports, not episode 1', async () => {
    // Episode numbers are not always 1..n, so the number is read rather than
    // assumed -- the same trap the episode source documents.
    catalogue.media = [{ publicId: 'm1' }];
    catalogue.episodes.m1 = [{ episodeNumber: 0 }];
    catalogue.segments.m1 = [segment('seg-1')];

    expect(locs(await run(sentencesSource))).toEqual(['/en/sentence/seg-1']);
  });

  test('skips a title with no episodes rather than submitting nothing-URLs', async () => {
    catalogue.media = [{ publicId: 'm1' }];
    catalogue.episodes.m1 = [];
    catalogue.segments.m1 = [segment('seg-1')];

    expect(await run(sentencesSource)).toEqual([]);
  });

  test.each([['HIDDEN'], ['DELETED']])('skips a %s segment, which is a permalink to nothing', async (status) => {
    catalogue.media = [{ publicId: 'm1' }];
    catalogue.episodes.m1 = [{ episodeNumber: 1 }];
    catalogue.segments.m1 = [segment('gone', { status }), segment('here')];

    expect(locs(await run(sentencesSource))).toEqual(['/en/sentence/here']);
  });

  test.each([['QUESTIONABLE'], ['EXPLICIT']])('does not PUSH a %s sentence', async (contentRating) => {
    // A sitemap is an active invitation rather than a statement that a page
    // exists, and these ratings change how a domain is classified for
    // everything else it hosts. They stay live and crawlable from their episode
    // pages; this decides what the site pushes, not what it serves.
    catalogue.media = [{ publicId: 'm1' }];
    catalogue.episodes.m1 = [{ episodeNumber: 1 }];
    catalogue.segments.m1 = [segment('spicy', { contentRating }), segment('safe')];

    expect(locs(await run(sentencesSource))).toEqual(['/en/sentence/safe']);
  });

  test.each([['SAFE'], ['SUGGESTIVE']])('but does submit a %s one', async (contentRating) => {
    catalogue.media = [{ publicId: 'm1' }];
    catalogue.episodes.m1 = [{ episodeNumber: 1 }];
    catalogue.segments.m1 = [segment('seg-1', { contentRating })];

    expect(locs(await run(sentencesSource))).toEqual(['/en/sentence/seg-1']);
  });

  test('skips a segment with no public id, which has no permalink', async () => {
    catalogue.media = [{ publicId: 'm1' }];
    catalogue.episodes.m1 = [{ episodeNumber: 1 }];
    catalogue.segments.m1 = [segment(''), segment('seg-2')];

    expect(locs(await run(sentencesSource))).toEqual(['/en/sentence/seg-2']);
  });

  test('caps how many it takes from any one title', async () => {
    // The cap is the one number to turn if the sample should grow; without it a
    // long-running title would crowd out the rest of the catalogue.
    catalogue.media = [{ publicId: 'm1' }];
    catalogue.episodes.m1 = [{ episodeNumber: 1 }];
    catalogue.segments.m1 = Array.from({ length: 100 }, (_, i) => segment(`seg-${i}`));

    expect(await run(sentencesSource)).toHaveLength(30);
  });

  test('never carries a lastmod, because a segment has no modification time here', async () => {
    catalogue.media = [{ publicId: 'm1' }];
    catalogue.episodes.m1 = [{ episodeNumber: 1 }];
    catalogue.segments.m1 = [segment('seg-1')];

    expect((await run(sentencesSource))[0]).not.toHaveProperty('lastmod');
  });

  test('one unreachable title costs its own sentences, not the sitemap', async () => {
    catalogue.media = [{ publicId: 'm1' }, { publicId: 'm2' }];
    catalogue.episodes.m1 = new Error('upstream down');
    catalogue.episodes.m2 = [{ episodeNumber: 1 }];
    catalogue.segments.m2 = [segment('seg-2')];

    expect(locs(await run(sentencesSource))).toEqual(['/en/sentence/seg-2']);
  });

  test('a title whose SEGMENTS fail costs only its own too', async () => {
    catalogue.media = [{ publicId: 'm1' }, { publicId: 'm2' }];
    catalogue.episodes.m1 = [{ episodeNumber: 1 }];
    catalogue.segments.m1 = new Error('upstream down');
    catalogue.episodes.m2 = [{ episodeNumber: 1 }];
    catalogue.segments.m2 = [segment('seg-2')];

    expect(locs(await run(sentencesSource))).toEqual(['/en/sentence/seg-2']);
  });

  test('submits the Spanish permalinks when the Spanish sitemap asks', async () => {
    catalogue.media = [{ publicId: 'm1' }];
    catalogue.episodes.m1 = [{ episodeNumber: 1 }];
    catalogue.segments.m1 = [segment('seg-1')];

    expect(locs(await run(sentencesSource, { locale: 'es' }))).toEqual(['/es/sentence/seg-1']);
  });

  test('covers every title in the catalogue, not just the first batch', async () => {
    // The per-title calls run in batches; an off-by-one in the batching drops
    // whole titles silently.
    catalogue.media = Array.from({ length: 19 }, (_, i) => ({ publicId: `m${i}` }));
    for (let i = 0; i < 19; i++) {
      catalogue.episodes[`m${i}`] = [{ episodeNumber: 1 }];
      catalogue.segments[`m${i}`] = [segment(`seg-${i}`)];
    }

    expect(await run(sentencesSource)).toHaveLength(19);
  });
});
