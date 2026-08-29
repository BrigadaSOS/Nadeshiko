import { describe, test, expect, beforeEach } from 'vitest';
// Importing the mocks registers them; it has to come before the command handler.
import { resetApiMocks, mockSearch, mockFetchRandom, mockGetSearchStats, mockDownloadFile } from '../mocks/api';

import { execute } from '../../commands/search';
import { FlowRunner } from '../harness/flow';
import { makeSegment, makeMedia, makeSearchResponse, makeSearchStatsResponse } from '../mocks/fixtures';

/**
 * The buttons on a search reply, driven end to end. `search.flow.test.ts`
 * covers opening a search and the context view; this covers the controls that
 * move within a result set -- pagination, the result picker, Random, and the
 * media filter's own paging.
 *
 * They are worth driving rather than unit-testing because the failure mode is
 * a click that silently does nothing: every handler decides whether to
 * re-render from a boolean, and a wrong one leaves the previous message on
 * screen with no error anywhere.
 */
const PAGE_SIZE = 20;
const media = makeMedia({ publicId: 'media-1', nameRomaji: 'Oshi No Ko' });

/** A page of `count` results whose sentences are numbered, so pages are distinguishable. */
function page(from: number, count: number, opts: { hasMore?: boolean; cursor?: string } = {}) {
  const segments = Array.from({ length: count }, (_, i) =>
    makeSegment({
      publicId: `seg-${from + i}`,
      mediaPublicId: 'media-1',
      textJa: { content: `文${from + i}`, highlight: `文${from + i}` },
    }),
  );
  return makeSearchResponse(
    segments,
    { 'media-1': media },
    {
      hasMore: opts.hasMore ?? true,
      cursor: opts.cursor ?? `cursor-${from + count}`,
    },
  );
}

/** Opens a search sitting on a full first page with more behind it. */
async function openSearch(flow: FlowRunner) {
  mockSearch.mockResolvedValue(page(1, PAGE_SIZE));
  return flow.executeCommand(execute, { query: '食べる' });
}

beforeEach(() => {
  resetApiMocks();
  mockDownloadFile.mockResolvedValue(null);
  mockGetSearchStats.mockResolvedValue(
    makeSearchStatsResponse([{ mediaPublicId: 'media-1', matchCount: 500 }], {
      'media-1': media,
    }),
  );
});

describe('pagination', () => {
  test('Next moves to the following page of results', async () => {
    const flow = new FlowRunner();
    await openSearch(flow);
    mockSearch.mockResolvedValue(page(21, PAGE_SIZE));

    const step = await flow.clickButton('next_page');

    expect(step.content).toContain('文21');
    expect(step.content).not.toContain('文1\n');
  });

  test('Prev comes back to the page before it', async () => {
    const flow = new FlowRunner();
    await openSearch(flow);
    mockSearch.mockResolvedValue(page(21, PAGE_SIZE));
    await flow.clickButton('next_page');

    const step = await flow.clickButton('prev_page');

    expect(step.content).toContain('文1');
  });

  test('First returns to the start from deep in a result set', async () => {
    const flow = new FlowRunner();
    await openSearch(flow);
    mockSearch.mockResolvedValue(page(21, PAGE_SIZE));
    await flow.clickButton('next_page');
    mockSearch.mockResolvedValue(page(41, PAGE_SIZE));
    await flow.clickButton('next_page');

    const step = await flow.clickButton('first_page');

    expect(step.content).toContain('文1');
  });

  test('Skip forward jumps several pages in a single request', async () => {
    const flow = new FlowRunner();
    await openSearch(flow);
    mockSearch.mockClear();
    mockSearch.mockResolvedValue(page(21, PAGE_SIZE * 5));

    const step = await flow.clickButton('skip_forward');

    expect(mockSearch).toHaveBeenCalledTimes(1);
    expect(step.content).toContain(`文${21 + PAGE_SIZE * 4}`);
  });

  test('Skip back returns towards the start', async () => {
    const flow = new FlowRunner();
    await openSearch(flow);
    mockSearch.mockResolvedValue(page(21, PAGE_SIZE * 5));
    await flow.clickButton('skip_forward');

    const step = await flow.clickButton('skip_back');

    expect(step.content).toContain('文1');
  });

  test('a Next click at the end of the results leaves the reply as it was', async () => {
    // Discord delivers clicks from stale messages, so a disabled button is not
    // a guarantee. Re-rendering an unchanged page would be harmless; rendering
    // an empty one would not.
    const flow = new FlowRunner();
    mockSearch.mockResolvedValue(page(1, 3, { hasMore: false }));
    const opened = await flow.executeCommand(execute, { query: '食べる' });

    const step = await flow.clickButton('next_page');

    expect(step.content).toBe(opened.content);
  });

  test('the pagination row disables backward controls on the first page', async () => {
    const flow = new FlowRunner();
    await openSearch(flow);

    const rendered = flow.getCapture().lastOfArgs(['editReply']);
    const buttons = rendered.components.flatMap((r: any) => r.toJSON().components);
    const byId = Object.fromEntries(buttons.map((b: any) => [b.custom_id, b.disabled ?? false]));

    expect(byId).toMatchObject({ first_page: true, prev_page: true, next_page: false });
  });
});

describe('the result picker', () => {
  test('selecting a result shows that sentence', async () => {
    const flow = new FlowRunner();
    await openSearch(flow);

    const step = await flow.selectMenu('search_select', ['seg-5']);

    expect(step.content).toContain('文5');
  });

  test('a selection that is no longer in the result set is ignored', async () => {
    // The menu belongs to a message that may predate a new search.
    const flow = new FlowRunner();
    const opened = await openSearch(flow);

    const step = await flow.selectMenu('search_select', ['seg-does-not-exist']);

    expect(step.content).toBe(opened.content);
  });

  test('the picker lists the results on the current page', async () => {
    const flow = new FlowRunner();
    const step = await openSearch(flow);

    const picker = step.selectMenus.find((m) => m.customId === 'search_select');
    expect(picker?.options.map((o) => o.value)).toContain('seg-1');
    expect(picker?.options).toHaveLength(PAGE_SIZE);
  });
});

describe('the Random button', () => {
  test('moves to a different result within the current page', async () => {
    const flow = new FlowRunner();
    const opened = await openSearch(flow);

    const step = await flow.clickButton('random_result');

    expect(step.content).not.toBe(opened.content);
    expect(step.content).toMatch(/文\d+/);
  });

  test('pulls in the next page when the current one holds a single result', async () => {
    // With one result there is no other index to jump to, so Random has to
    // fetch rather than silently do nothing.
    const flow = new FlowRunner();
    mockSearch.mockResolvedValue(page(1, 1, { hasMore: true }));
    await flow.executeCommand(execute, { query: '食べる' });
    mockSearch.mockResolvedValue(page(50, PAGE_SIZE));

    const step = await flow.clickButton('random_result');

    expect(step.content).toMatch(/文(5[0-9]|6[0-9])/);
  });

  test('does nothing when there is exactly one result and no more pages', async () => {
    const flow = new FlowRunner();
    mockSearch.mockResolvedValue(page(1, 1, { hasMore: false }));
    const opened = await flow.executeCommand(execute, { query: '食べる' });

    const step = await flow.clickButton('random_result');

    expect(step.content).toBe(opened.content);
  });

  test('draws a fresh sentence in random mode, where there is no result set to walk', async () => {
    const flow = new FlowRunner();
    mockFetchRandom.mockResolvedValue(page(1, 1, { hasMore: false }));
    await flow.executeCommand(execute, {});
    mockFetchRandom.mockResolvedValue(page(99, 1, { hasMore: false }));

    const step = await flow.clickButton('random_result');

    expect(step.content).toContain('文99');
  });
});

describe('the media filter’s own paging', () => {
  /** A search whose filter list spans several pages. */
  async function openFilter(flow: FlowRunner) {
    const many = Array.from({ length: 60 }, (_, i) => ({ mediaPublicId: `m-${i}`, matchCount: 100 - i }));
    const mediaMap = Object.fromEntries(
      many.map((m) => [
        m.mediaPublicId,
        makeMedia({ publicId: m.mediaPublicId, nameRomaji: `Show ${m.mediaPublicId}` }),
      ]),
    );
    mockGetSearchStats.mockResolvedValue(makeSearchStatsResponse(many, mediaMap));
    await openSearch(flow);
    return flow.clickButton('filter_media');
  }

  test('opens on the first page of media', async () => {
    const flow = new FlowRunner();

    const step = await openFilter(flow);

    expect(step.content).toContain('Page 1 of');
    expect(step.buttons).toContain('filter_media_next');
  });

  test('Next advances a page', async () => {
    const flow = new FlowRunner();
    await openFilter(flow);

    const step = await flow.clickButton('filter_media_next');

    expect(step.content).toContain('Page 2 of');
  });

  test('Last jumps to the final page', async () => {
    const flow = new FlowRunner();
    await openFilter(flow);

    const step = await flow.clickButton('filter_media_last');

    expect(step.content).toContain('Page 3 of 3');
  });

  test('First comes back to the beginning', async () => {
    const flow = new FlowRunner();
    await openFilter(flow);
    await flow.clickButton('filter_media_last');

    const step = await flow.clickButton('filter_media_first');

    expect(step.content).toContain('Page 1 of 3');
  });

  test('Prev does not step off the front of the list', async () => {
    // `mediaPage - 1` unclamped is -1, which slices an empty page.
    const flow = new FlowRunner();
    await openFilter(flow);

    const step = await flow.clickButton('filter_media_prev');

    expect(step.content).toContain('Page 1 of 3');
  });

  test('the name-filter button opens a modal rather than filtering blind', async () => {
    const flow = new FlowRunner();
    await openFilter(flow);

    const step = await flow.clickButton('filter_media_search');

    expect(step.modalShown).toBe(true);
    expect(step.modalCustomId).toBe('filter_media_search_modal');
  });

  test('Cancel returns to the search results', async () => {
    const flow = new FlowRunner();
    await openFilter(flow);

    const step = await flow.clickButton('cancel_filter_media');

    expect(step.content).toContain('文1');
  });
});

describe('when a filtered search finds nothing', () => {
  test('says so instead of leaving the previous results on screen', async () => {
    const flow = new FlowRunner();
    mockGetSearchStats.mockResolvedValue(
      makeSearchStatsResponse([{ mediaPublicId: 'media-1', matchCount: 500 }], { 'media-1': media }),
    );
    await openSearch(flow);
    await flow.clickButton('filter_media');
    mockSearch.mockResolvedValue(page(0, 0, { hasMore: false }));

    await flow.selectMenu('filter_media_select', ['media-1']);

    const followUp = flow.getCapture().lastArgs('followUp');
    expect(followUp.content).toContain('No results found in');
  });
});
