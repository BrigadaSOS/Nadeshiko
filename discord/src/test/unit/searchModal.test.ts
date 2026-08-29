import { describe, test, expect, beforeEach } from 'vitest';
// Importing the mocks registers them; it has to come before the module under test.
import { resetApiMocks, mockSearch } from '../mocks/api';

import {
  createSearchModalState,
  resetPages,
  goToNextPage,
  goToPrevPage,
  goToFirstPage,
  goToSkipBack,
  goToSkipForward,
  buildPaginationButtons,
  getPageOffset,
  createFilterMediaState,
  applyNameFilter,
  handleFilterMediaSelect,
  renderFilterMediaPage,
  MEDIA_PER_PAGE,
  type SearchModalState,
  type FilterMediaItem,
} from '../../searchModal';
import { makeSegment, makeMedia, makeSearchResponse } from '../mocks/fixtures';

/**
 * The page cache is the part of the bot most likely to be wrong in a way nobody
 * notices in review: every one of these functions mutates the same state object
 * and returns a boolean the caller uses to decide whether to re-render. Return
 * `true` without moving and the user clicks a button that does nothing; move
 * without returning `true` and the reply shows a stale page. Both are silent.
 *
 * `BOT_CONFIG.maxSearchResults` is 20 in the shared mock, so a "full" page is
 * twenty segments -- which is also what tells `hasMore` from a short last page.
 */
const PAGE_SIZE = 20;

/** A page of `count` segments, numbered from `from` so pages are distinguishable. */
function page(from: number, count: number, opts: { hasMore?: boolean; cursor?: string } = {}) {
  const segments = Array.from({ length: count }, (_, i) => makeSegment({ publicId: `seg-${from + i}` }));
  return makeSearchResponse(
    segments,
    { 'media-1': makeMedia({ publicId: 'media-1' }) },
    {
      hasMore: opts.hasMore ?? true,
      cursor: opts.cursor ?? `cursor-${from + count}`,
    },
  );
}

/** The options bag the nth `search` call was made with. */
function searchOptionsOfCall(index: number): Record<string, unknown> {
  return (mockSearch.mock.calls[index] as unknown as [string, Record<string, unknown>])[1];
}

/** The publicId of the first segment on the page the state is currently showing. */
function currentFirst(state: SearchModalState) {
  return state.results?.segments[0]?.publicId;
}

beforeEach(() => {
  resetApiMocks();
});

describe('createSearchModalState', () => {
  test('starts empty and on page zero', () => {
    const state = createSearchModalState();

    expect(state).toMatchObject({ results: null, currentIndex: 0, currentPage: 0, pages: [], lastQuery: '' });
  });

  test('carries the media filter it was opened with', () => {
    expect(createSearchModalState('media-9').mediaPublicId).toBe('media-9');
  });
});

describe('resetPages', () => {
  test('a new search discards the cached pages of the previous one', async () => {
    // Keeping them would let Next walk from a search for 食べる straight into
    // page two of a search for 飲む.
    const state = createSearchModalState();
    resetPages(state, page(1, PAGE_SIZE));
    mockSearch.mockResolvedValue(page(21, PAGE_SIZE));
    await goToNextPage(state);

    resetPages(state, page(100, PAGE_SIZE));

    expect(state.pages).toHaveLength(1);
    expect(state.currentPage).toBe(0);
    expect(currentFirst(state)).toBe('seg-100');
  });
});

describe('goToNextPage', () => {
  test('fetches the next page using the cursor the last one returned', async () => {
    const state = createSearchModalState();
    state.lastQuery = '食べる';
    resetPages(state, page(1, PAGE_SIZE, { cursor: 'cursor-21' }));
    mockSearch.mockResolvedValue(page(21, PAGE_SIZE));

    expect(await goToNextPage(state)).toBe(true);
    expect(searchOptionsOfCall(0)).toMatchObject({ cursor: 'cursor-21' });
    expect(currentFirst(state)).toBe('seg-21');
  });

  test('carries the search options forward, so page two has the same filters as page one', async () => {
    // Dropping them is the classic paging bug: page one is filtered to one
    // anime and page two silently is not.
    const state = createSearchModalState('media-1');
    state.lastQuery = '食べる';
    state.lastSearchOptions = { exactMatch: true, category: 'ANIME', episodes: [3], sort: 'TIME_ASC' };
    resetPages(state, page(1, PAGE_SIZE));
    mockSearch.mockResolvedValue(page(21, PAGE_SIZE));

    await goToNextPage(state);

    expect(searchOptionsOfCall(0)).toMatchObject({
      exactMatch: true,
      category: 'ANIME',
      episodes: [3],
      sort: 'TIME_ASC',
      mediaPublicId: 'media-1',
    });
  });

  test('serves an already-visited page from the cache instead of re-fetching', async () => {
    const state = createSearchModalState();
    resetPages(state, page(1, PAGE_SIZE));
    mockSearch.mockResolvedValue(page(21, PAGE_SIZE));
    await goToNextPage(state);
    goToPrevPage(state);
    mockSearch.mockClear();

    expect(await goToNextPage(state)).toBe(true);
    expect(mockSearch).not.toHaveBeenCalled();
    expect(currentFirst(state)).toBe('seg-21');
  });

  test('refuses when the backend said there is nothing more', async () => {
    const state = createSearchModalState();
    resetPages(state, page(1, 5, { hasMore: false }));

    expect(await goToNextPage(state)).toBe(false);
    expect(mockSearch).not.toHaveBeenCalled();
  });

  test('refuses when hasMore is set but no cursor came with it', async () => {
    // Paging without a cursor re-runs the same query and returns page one
    // again -- Next appears to work while showing the same twenty results.
    const state = createSearchModalState();
    resetPages(state, page(1, PAGE_SIZE, { cursor: '' }));

    expect(await goToNextPage(state)).toBe(false);
    expect(mockSearch).not.toHaveBeenCalled();
  });

  test('refuses, and stays put, when the fetch comes back empty', async () => {
    const state = createSearchModalState();
    resetPages(state, page(1, PAGE_SIZE));
    mockSearch.mockResolvedValue(page(0, 0, { hasMore: false }));

    expect(await goToNextPage(state)).toBe(false);
    expect(state.currentPage).toBe(0);
    expect(currentFirst(state)).toBe('seg-1');
  });

  test('resets the cursor within the page, so a new page opens on its first result', async () => {
    const state = createSearchModalState();
    resetPages(state, page(1, PAGE_SIZE));
    state.currentIndex = 7;
    mockSearch.mockResolvedValue(page(21, PAGE_SIZE));

    await goToNextPage(state);

    expect(state.currentIndex).toBe(0);
  });
});

describe('goToPrevPage and goToFirstPage', () => {
  /** A state sitting on page 2 with pages 0..2 cached. */
  async function onPageTwo() {
    const state = createSearchModalState();
    resetPages(state, page(1, PAGE_SIZE));
    mockSearch.mockResolvedValueOnce(page(21, PAGE_SIZE));
    await goToNextPage(state);
    mockSearch.mockResolvedValueOnce(page(41, PAGE_SIZE));
    await goToNextPage(state);
    return state;
  }

  test('Prev steps back one page', async () => {
    const state = await onPageTwo();

    expect(goToPrevPage(state)).toBe(true);
    expect(state.currentPage).toBe(1);
    expect(currentFirst(state)).toBe('seg-21');
  });

  test('First jumps all the way back', async () => {
    const state = await onPageTwo();

    expect(goToFirstPage(state)).toBe(true);
    expect(state.currentPage).toBe(0);
    expect(currentFirst(state)).toBe('seg-1');
  });

  test.each([
    ['goToPrevPage', goToPrevPage],
    ['goToFirstPage', goToFirstPage],
    ['goToSkipBack', goToSkipBack],
  ])('%s reports no movement when already on page one', (_name, move) => {
    // The button is disabled on page one, but Discord still delivers a click
    // from a stale message. Returning true would re-render for nothing.
    const state = createSearchModalState();
    resetPages(state, page(1, PAGE_SIZE));

    expect(move(state)).toBe(false);
  });
});

describe('goToSkipBack', () => {
  test('jumps back by ten pages', async () => {
    const state = createSearchModalState();
    resetPages(state, page(1, PAGE_SIZE));
    for (let i = 0; i < 12; i++) {
      mockSearch.mockResolvedValueOnce(page((i + 1) * PAGE_SIZE + 1, PAGE_SIZE));
      await goToNextPage(state);
    }

    expect(goToSkipBack(state)).toBe(true);
    expect(state.currentPage).toBe(2);
  });

  test('clamps at page one rather than going negative', async () => {
    // A negative index reads `state.pages[-3]` as undefined and renders an
    // empty message.
    const state = createSearchModalState();
    resetPages(state, page(1, PAGE_SIZE));
    mockSearch.mockResolvedValue(page(21, PAGE_SIZE));
    await goToNextPage(state);

    expect(goToSkipBack(state)).toBe(true);
    expect(state.currentPage).toBe(0);
    expect(state.results).toBeDefined();
  });
});

describe('goToSkipForward', () => {
  test('fetches several pages in one request and lands on the fifth', async () => {
    // The point of the bulk fetch is one API round-trip instead of five.
    const state = createSearchModalState();
    resetPages(state, page(1, PAGE_SIZE));
    mockSearch.mockResolvedValue(page(21, PAGE_SIZE * 5));

    expect(await goToSkipForward(state)).toBe(true);
    expect(mockSearch).toHaveBeenCalledTimes(1);
    expect(state.currentPage).toBe(5);
    expect(currentFirst(state)).toBe(`seg-${21 + PAGE_SIZE * 4}`);
  });

  test('caps the bulk request at the API’s hundred-result ceiling', async () => {
    // Asking for more than the API will return is a request it rejects
    // outright, which turns Skip into an error instead of a jump.
    const state = createSearchModalState();
    resetPages(state, page(1, PAGE_SIZE));
    mockSearch.mockResolvedValue(page(21, 100));

    await goToSkipForward(state, 10);

    expect(searchOptionsOfCall(0).take).toBe(100);
  });

  test('splits the bulk response into pages of the normal size', async () => {
    const state = createSearchModalState();
    resetPages(state, page(1, PAGE_SIZE));
    mockSearch.mockResolvedValue(page(21, PAGE_SIZE * 3));

    await goToSkipForward(state, 3);

    expect(state.pages[1].segments).toHaveLength(PAGE_SIZE);
    expect(state.pages[2].segments).toHaveLength(PAGE_SIZE);
    expect(state.pages[3].segments).toHaveLength(PAGE_SIZE);
  });

  test('only the last split page keeps the cursor, so Next resumes from the right place', async () => {
    // Giving every split page the same cursor makes Next from page 1 jump to
    // whatever followed page 3.
    const state = createSearchModalState();
    resetPages(state, page(1, PAGE_SIZE));
    mockSearch.mockResolvedValue(page(21, PAGE_SIZE * 3, { cursor: 'cursor-81' }));

    await goToSkipForward(state, 3);

    expect(state.pages[1].pagination.cursor).toBe('');
    expect(state.pages[2].pagination.cursor).toBe('');
    expect(state.pages[3].pagination.cursor).toBe('cursor-81');
  });

  test('the intermediate split pages are marked as having more, because they do', async () => {
    const state = createSearchModalState();
    resetPages(state, page(1, PAGE_SIZE));
    mockSearch.mockResolvedValue(page(21, PAGE_SIZE * 3, { hasMore: false }));

    await goToSkipForward(state, 3);

    expect(state.pages[1].pagination.hasMore).toBe(true);
    expect(state.pages[2].pagination.hasMore).toBe(true);
    expect(state.pages[3].pagination.hasMore).toBe(false);
  });

  test('lands on the last page that exists when the corpus runs out early', async () => {
    // Asking to skip five when only two more pages exist must not leave the
    // state pointing at an index that was never filled.
    const state = createSearchModalState();
    resetPages(state, page(1, PAGE_SIZE));
    mockSearch.mockResolvedValue(page(21, PAGE_SIZE * 2, { hasMore: false }));

    expect(await goToSkipForward(state, 5)).toBe(true);
    expect(state.currentPage).toBe(2);
    expect(state.results).toBe(state.pages[2]);
  });

  test('refuses when the backend said there is nothing more', async () => {
    const state = createSearchModalState();
    resetPages(state, page(1, 5, { hasMore: false }));

    expect(await goToSkipForward(state)).toBe(false);
    expect(mockSearch).not.toHaveBeenCalled();
  });

  test('refuses when there is no cursor and nothing cached ahead', async () => {
    const state = createSearchModalState();
    resetPages(state, page(1, PAGE_SIZE, { cursor: '' }));

    expect(await goToSkipForward(state)).toBe(false);
  });

  test('refuses when the bulk fetch comes back empty', async () => {
    const state = createSearchModalState();
    resetPages(state, page(1, PAGE_SIZE));
    mockSearch.mockResolvedValue(page(0, 0, { hasMore: false }));

    expect(await goToSkipForward(state)).toBe(false);
    expect(state.currentPage).toBe(0);
  });

  test('serves entirely from cache when the target pages were already fetched', async () => {
    const state = createSearchModalState();
    resetPages(state, page(1, PAGE_SIZE));
    mockSearch.mockResolvedValue(page(21, PAGE_SIZE * 5));
    await goToSkipForward(state, 5);
    goToFirstPage(state);
    mockSearch.mockClear();

    expect(await goToSkipForward(state, 5)).toBe(true);
    expect(mockSearch).not.toHaveBeenCalled();
    expect(state.currentPage).toBe(5);
  });
});

describe('buildPaginationButtons', () => {
  /** Disabled state keyed by custom id, as Discord will receive it. */
  function disabled(state: SearchModalState) {
    return Object.fromEntries(
      buildPaginationButtons(state).map((b) => {
        const json = b.toJSON() as { custom_id: string; disabled?: boolean };
        return [json.custom_id, json.disabled ?? false];
      }),
    );
  }

  test('back controls are disabled on the first page', () => {
    const state = createSearchModalState();
    resetPages(state, page(1, PAGE_SIZE));

    expect(disabled(state)).toMatchObject({ first_page: true, skip_back: true, prev_page: true });
  });

  test('back controls open up once past the first page', async () => {
    const state = createSearchModalState();
    resetPages(state, page(1, PAGE_SIZE));
    mockSearch.mockResolvedValue(page(21, PAGE_SIZE));
    await goToNextPage(state);

    expect(disabled(state)).toMatchObject({ first_page: false, skip_back: false, prev_page: false });
  });

  test('forward controls are disabled on a short last page even when hasMore is set', () => {
    // A page holding fewer than a full page of results is the end of the road
    // regardless of what the flag says; offering Next there produces an empty
    // fetch and a dead button.
    const state = createSearchModalState();
    resetPages(state, page(1, 5, { hasMore: true }));

    expect(disabled(state)).toMatchObject({ next_page: true, skip_forward: true });
  });

  test('forward controls are enabled on a full page with more behind it', () => {
    const state = createSearchModalState();
    resetPages(state, page(1, PAGE_SIZE, { hasMore: true }));

    expect(disabled(state)).toMatchObject({ next_page: false, skip_forward: false });
  });

  test('forward controls are disabled when the backend says there is no more', () => {
    const state = createSearchModalState();
    resetPages(state, page(1, PAGE_SIZE, { hasMore: false }));

    expect(disabled(state)).toMatchObject({ next_page: true, skip_forward: true });
  });
});

describe('getPageOffset', () => {
  test('numbers results continuously across pages', async () => {
    // This is what makes the reply say "result 21 of 150" rather than
    // restarting at 1 on every page.
    const state = createSearchModalState();
    resetPages(state, page(1, PAGE_SIZE));
    expect(getPageOffset(state)).toBe(0);

    mockSearch.mockResolvedValue(page(21, PAGE_SIZE));
    await goToNextPage(state);

    expect(getPageOffset(state)).toBe(PAGE_SIZE);
  });
});

describe('applyNameFilter', () => {
  const catalogue: FilterMediaItem[] = [
    { mediaPublicId: 'm-1', name: 'Oshi no Ko', nameRomaji: 'Oshi no Ko', nameJa: '推しの子', matchCount: 10 },
    {
      mediaPublicId: 'm-2',
      name: 'Spy x Family',
      nameRomaji: 'Spy x Family',
      nameJa: 'スパイファミリー',
      matchCount: 5,
    },
    {
      mediaPublicId: 'm-3',
      name: 'Steins;Gate',
      nameRomaji: 'Steins Gate',
      nameJa: 'シュタインズ・ゲート',
      matchCount: 7,
    },
  ];

  function filtered(name: string) {
    const state = createFilterMediaState();
    state.allMedia = catalogue;
    state.filteredMedia = catalogue;
    applyNameFilter(state, name);
    return state;
  }

  test('matches on a substring of the romaji name', () => {
    expect(filtered('spy').filteredMedia.map((m) => m.mediaPublicId)).toEqual(['m-2']);
  });

  test('matches on the Japanese name', () => {
    expect(filtered('推し').filteredMedia.map((m) => m.mediaPublicId)).toEqual(['m-1']);
  });

  test('ignores punctuation, so "steins gate" finds "Steins;Gate"', () => {
    // Nobody types the semicolon. Matching literally makes the title
    // unfindable by the name people actually know it by.
    expect(filtered('steins gate').filteredMedia.map((m) => m.mediaPublicId)).toEqual(['m-3']);
  });

  test('ignores case', () => {
    expect(filtered('OSHI').filteredMedia.map((m) => m.mediaPublicId)).toEqual(['m-1']);
  });

  test('an empty filter restores the full list', () => {
    const state = filtered('spy');

    applyNameFilter(state, '');

    expect(state.filteredMedia).toHaveLength(3);
    expect(state.nameFilter).toBe('');
  });

  test('returns to the first page, since the old page number may not exist any more', () => {
    const state = createFilterMediaState();
    state.allMedia = catalogue;
    state.mediaPage = 4;

    applyNameFilter(state, 'spy');

    expect(state.mediaPage).toBe(0);
  });

  test('a filter matching nothing yields an empty list rather than the whole catalogue', () => {
    expect(filtered('zzzz').filteredMedia).toEqual([]);
  });
});

describe('handleFilterMediaSelect', () => {
  const catalogue: FilterMediaItem[] = [{ mediaPublicId: 'm-1', name: 'Oshi no Ko', matchCount: 10 }];

  function select(value: string) {
    const state = createSearchModalState('m-old');
    const filterState = createFilterMediaState();
    filterState.allMedia = catalogue;
    handleFilterMediaSelect({ values: [value] } as never, state, filterState);
    return state;
  }

  test('picking a media narrows the search to it, and names it for the reply', () => {
    expect(select('m-1')).toMatchObject({ mediaPublicId: 'm-1', mediaName: 'Oshi no Ko' });
  });

  test('the "all media" sentinel clears the filter rather than searching for a media called __all__', () => {
    expect(select('__all__')).toMatchObject({ mediaPublicId: undefined, mediaName: undefined });
  });
});

describe('renderFilterMediaPage', () => {
  const many: FilterMediaItem[] = Array.from({ length: MEDIA_PER_PAGE * 2 + 3 }, (_, i) => ({
    mediaPublicId: `m-${i}`,
    name: `Media ${i}`,
    matchCount: 100 - i,
  }));

  /** Renders one page and returns what would have been sent to Discord. */
  async function render(filterOverrides: Partial<ReturnType<typeof createFilterMediaState>> = {}) {
    const state = createSearchModalState();
    const filterState = Object.assign(createFilterMediaState(), {
      allMedia: many,
      filteredMedia: many,
      ...filterOverrides,
    });
    let sent: any;
    await renderFilterMediaPage({ editReply: (async (d: unknown) => (sent = d)) as never }, state, filterState);
    return sent;
  }

  /** Select-menu option values, as Discord would receive them. */
  function optionValues(sent: any) {
    return sent.components[0].toJSON().components[0].options.map((o: { value: string }) => o.value);
  }

  test('never offers more options than Discord’s 25-per-menu limit', async () => {
    // 24 media plus the "all media" entry is exactly 25. One more and Discord
    // rejects the message and the filter UI never opens.
    const options = optionValues(await render());

    expect(options).toHaveLength(MEDIA_PER_PAGE + 1);
  });

  test('the clear-filter entry comes first, so it is reachable without scrolling', async () => {
    expect(optionValues(await render())[0]).toBe('__all__');
  });

  test('shows pagination controls only when there is more than one page', async () => {
    const manyPages = await render();
    const onePage = await render({ allMedia: many.slice(0, 5), filteredMedia: many.slice(0, 5) });

    const ids = (sent: any) => sent.components.flatMap((r: any) => r.toJSON().components.map((c: any) => c.custom_id));
    expect(ids(manyPages)).toContain('filter_media_next');
    expect(ids(onePage)).not.toContain('filter_media_next');
  });

  test('numbers entries continuously across pages', async () => {
    // Restarting at 1) on every page makes the numbers useless for saying
    // "pick number 30".
    const secondPage = await render({ mediaPage: 1 });

    expect(secondPage.content).toContain(`${MEDIA_PER_PAGE + 1}) Media ${MEDIA_PER_PAGE}`);
  });

  test('disables Next on the last page and Prev on the first', async () => {
    const lastPageIndex = Math.ceil(many.length / MEDIA_PER_PAGE) - 1;
    const first = await render({ mediaPage: 0 });
    const last = await render({ mediaPage: lastPageIndex });

    const disabledIds = (sent: any) =>
      sent.components
        .flatMap((r: any) => r.toJSON().components)
        .filter((c: any) => c.disabled)
        .map((c: any) => c.custom_id);
    expect(disabledIds(first)).toEqual(expect.arrayContaining(['filter_media_first', 'filter_media_prev']));
    expect(disabledIds(last)).toEqual(expect.arrayContaining(['filter_media_next', 'filter_media_last']));
  });

  test('says what the list is filtered by, so an empty page is explicable', async () => {
    const sent = await render({ nameFilter: 'spy' });

    expect(sent.content).toContain('filtering by "spy"');
  });

  test('clears attachments, so the clip from the previous result does not linger', async () => {
    // The filter UI replaces a message that had a video attached. Without an
    // explicit empty `files`, Discord keeps the old attachment.
    expect((await render()).files).toEqual([]);
  });
});
