import { describe, test, expect, beforeEach, vi } from 'vitest';
import { reactive } from 'vue';

/**
 * Where a change to "which title am I looking at" should land.
 *
 * Two URLs can hold that scope and they hold it in different places:
 * `/search/<word>?media=<id>` carries it in the QUERY, because the word is the
 * subject and the title is a filter on it, while `/media/<slug>` carries it in
 * the PATH, because the title is the subject. Patching `?media=` works for the
 * first and is inert for the second -- `SearchContainer` reads the path there,
 * so the URL would change and the page would not.
 *
 * That is the whole reason this exists rather than four filter controls each
 * calling `setQuery({ media })`, and it is why the tests below are mostly about
 * which of the two mechanisms was used, not just about where the reader ends up.
 */
const route = reactive({
  path: '/search/kanji',
  params: {} as Record<string, unknown>,
  query: {} as Record<string, unknown>,
});
const push = vi.fn();
const setQuery = vi.fn();
const scrollToTop = vi.fn();

vi.stubGlobal('useRoute', () => route);
vi.stubGlobal('useRouter', () => ({ push }));
vi.stubGlobal('useLocalePath', () => (path: string) => `/es${path}`);
vi.stubGlobal('useQuerySync', () => ({ setQuery, scrollToTop }));

import { useMediaScope } from './useMediaScope';

beforeEach(() => {
  vi.clearAllMocks();
  route.path = '/search/kanji';
  route.params = { query: 'kanji' };
  route.query = {};
});

describe('knowing which kind of page this is', () => {
  test('a title page carries the scope in its path', () => {
    route.path = '/media/oshi-no-ko';

    expect(useMediaScope().isMediaPage.value).toBe(true);
  });

  test('and still does under a locale prefix, which is most of the traffic', () => {
    // Reading `startsWith('/media/')` off the raw path would make every
    // localized title page behave like a search page.
    route.path = '/es/media/oshi-no-ko';

    expect(useMediaScope().isMediaPage.value).toBe(true);
  });

  test('the media INDEX is not a title page; it has no title to scope to', () => {
    route.path = '/media';

    expect(useMediaScope().isMediaPage.value).toBe(false);
  });

  test('a search page is not one either', () => {
    route.path = '/search/kanji';

    expect(useMediaScope().isMediaPage.value).toBe(false);
  });
});

describe('picking a title while a search is running', () => {
  test('keeps the word as the subject and filters it, rather than navigating away', () => {
    // The reader searched for a word; scoping to a title must not throw the
    // word away.
    useMediaScope().selectMedia('media-1', 'oshi-no-ko');

    expect(setQuery).toHaveBeenCalledWith({ media: 'media-1', episode: null }, { scroll: true });
    expect(push).not.toHaveBeenCalled();
  });

  test('drops the episode, which does not survive a change of title', () => {
    // Episode numbers are per title; carrying one across filters the new list
    // to nothing.
    route.query = { media: 'media-9', episode: '3' };

    useMediaScope().selectMedia('media-1', 'oshi-no-ko');

    expect(setQuery).toHaveBeenCalledWith(expect.objectContaining({ episode: null }), expect.anything());
  });
});

describe('picking a title while browsing', () => {
  beforeEach(() => {
    route.path = '/media';
    route.params = {};
  });

  test('makes the title the subject, on its own indexable URL', () => {
    useMediaScope().selectMedia('media-1', 'oshi-no-ko');

    expect(push).toHaveBeenCalledWith({ path: '/es/media/oshi-no-ko' });
    expect(setQuery).not.toHaveBeenCalled();
  });

  test('and puts the reader at the top of the new title', () => {
    useMediaScope().selectMedia('media-1', 'oshi-no-ko');

    expect(scrollToTop).toHaveBeenCalled();
  });

  test('falls back to the query form when the title has no slug yet', () => {
    // An older payload, or a title still being imported. A filter click must
    // never dead-end because a slug was absent.
    useMediaScope().selectMedia('media-1', null);

    expect(setQuery).toHaveBeenCalledWith({ media: 'media-1', episode: null }, { scroll: true });
    expect(push).not.toHaveBeenCalled();
  });

  test('falls back when no slug was passed at all', () => {
    useMediaScope().selectMedia('media-1');

    expect(setQuery).toHaveBeenCalled();
  });
});

describe('clearing the title', () => {
  test('on a search page it is just a wider filter', () => {
    route.path = '/search/kanji';
    route.query = { media: 'media-1', episode: '3' };

    useMediaScope().selectMedia(null);

    expect(setQuery).toHaveBeenCalledWith({ media: null, episode: null });
    expect(push).not.toHaveBeenCalled();
  });

  test('on a TITLE page it has to leave the page, since the path is the filter', () => {
    // Patching the query here would change the URL and leave the same title on
    // screen, because the path is what the page reads.
    route.path = '/media/oshi-no-ko';
    route.params = {};

    useMediaScope().selectMedia(null);

    expect(push).toHaveBeenCalledWith({ path: '/es/search', query: {} });
  });

  test('keeps HOW the reader was looking, and drops WHAT they were looking at', () => {
    // Category and sort are the reader's settings; the title and episode are
    // the thing being cleared.
    route.path = '/media/oshi-no-ko';
    route.params = {};
    route.query = { media: 'media-1', episode: '3', category: 'anime', sort: 'recent' };

    useMediaScope().selectMedia(null);

    expect(push).toHaveBeenCalledWith({ path: '/es/search', query: { category: 'anime', sort: 'recent' } });
  });

  test('does not mutate the route’s own query while doing it', () => {
    // `route.query` is shared; deleting from it in place would strip the
    // episode from the URL the reader is still on if the push failed.
    route.path = '/media/oshi-no-ko';
    route.params = {};
    route.query = { episode: '3' };

    useMediaScope().selectMedia(null);

    expect(route.query.episode).toBe('3');
  });
});
