import { describe, test, expect, beforeEach } from 'bun:test';
import {
  registerMocks,
  resetApiMocks,
  mockSearch,
  mockFetchRandom,
  mockGetSearchStats,
  mockGetSegmentContext,
  mockDownloadFile,
} from '../mocks/api';

// Register mocks BEFORE importing command handlers
registerMocks();

import { execute } from '../../commands/search';
import { FlowRunner } from '../harness/flow';
import {
  makeSegment,
  makeMedia,
  makeSearchResponse,
  makeSearchStatsResponse,
  makeContextResponse,
} from '../mocks/fixtures';

const media1 = makeMedia({ publicId: 'media-1', nameRomaji: 'Oshi No Ko', nameJa: '推しの子' });
const media2 = makeMedia({ publicId: 'media-2', nameRomaji: 'Spy x Family', nameJa: 'スパイファミリー' });

describe('/search flow', () => {
  let flow: FlowRunner;

  beforeEach(() => {
    flow = new FlowRunner();
    resetApiMocks();
    mockDownloadFile.mockResolvedValue(null);
  });

  test('search with query shows results', async () => {
    const seg1 = makeSegment({
      publicId: 'seg-1',
      textJa: { content: '食べたい', highlight: '<em>食べ</em>たい' },
      mediaPublicId: 'media-1',
      episode: 3,
    });
    const seg2 = makeSegment({
      publicId: 'seg-2',
      textJa: { content: '食べました', highlight: '<em>食べ</em>ました' },
      mediaPublicId: 'media-2',
      episode: 1,
    });

    mockSearch.mockResolvedValue(
      makeSearchResponse([seg1, seg2], { 'media-1': media1, 'media-2': media2 }, { estimatedTotalHits: 150 }),
    );

    const step = await flow.executeCommand(execute, { query: '食べる' });

    expect(step.content).toContain('~150 results');
    expect(step.content).toContain('食べる');
    expect(step.content).toContain('**食べ**たい');
    expect(step.buttons).toContain('advanced_search');
    expect(step.buttons).toContain('filter_media');
    expect(step.buttons).toContain('random_result');
    expect(step.buttons).toContain('context');
    expect(step.selectMenus).toContainEqual(expect.objectContaining({ customId: 'search_select' }));
  });

  test('search with no query shows random sentence', async () => {
    const seg = makeSegment({
      publicId: 'seg-random',
      textJa: { content: 'ランダムな文' },
      mediaPublicId: 'media-1',
    });

    mockFetchRandom.mockResolvedValue(makeSearchResponse([seg], { 'media-1': media1 }));
    mockGetSearchStats.mockResolvedValue(
      makeSearchStatsResponse([{ publicId: 'media-1', matchCount: 5000 }], { 'media-1': media1 }),
    );

    const step = await flow.executeCommand(execute, {});

    expect(step.content).toContain('ランダムな文');
    expect(step.content).toContain('5,000');
    expect(step.buttons).toContain('advanced_search');
    expect(step.buttons).toContain('filter_media');
    expect(step.buttons).toContain('random_result');
    expect(step.buttons).toContain('context');
  });

  test('search -> click Search button -> fill modal -> results', async () => {
    // Step 1: initial random
    const randomSeg = makeSegment({
      publicId: 'seg-random',
      textJa: { content: 'ランダム' },
      mediaPublicId: 'media-1',
    });
    mockFetchRandom.mockResolvedValue(makeSearchResponse([randomSeg], { 'media-1': media1 }));
    mockGetSearchStats.mockResolvedValue(makeSearchStatsResponse([], { 'media-1': media1 }));

    await flow.executeCommand(execute, {});

    // Step 2: click Search button -> modal appears
    const step2 = await flow.clickButton('advanced_search');
    expect(step2.modalShown).toBe(true);
    expect(step2.modalCustomId).toBe('advanced_search_modal');

    // Step 3: submit modal with query
    const searchSeg = makeSegment({
      publicId: 'seg-search-1',
      textJa: { content: '食べたい', highlight: '<em>食べ</em>たい' },
      mediaPublicId: 'media-1',
    });
    mockSearch.mockResolvedValue(makeSearchResponse([searchSeg], { 'media-1': media1 }, { estimatedTotalHits: 42 }));

    const step3 = await flow.submitModal({
      search_query: '食べる',
      search_episodes: '',
      search_sort: '',
    });

    expect(step3.content).toContain('~42 results');
    expect(step3.content).toContain('食べる');
    expect(step3.content).toContain('**食べ**たい');
  });

  test('search -> filter media -> select media -> filtered results', async () => {
    // Step 1: search with query
    const seg1 = makeSegment({
      publicId: 'seg-1',
      textJa: { content: '食べたい', highlight: '<em>食べ</em>たい' },
      mediaPublicId: 'media-1',
    });
    mockSearch.mockResolvedValue(makeSearchResponse([seg1], { 'media-1': media1 }, { estimatedTotalHits: 100 }));

    await flow.executeCommand(execute, { query: '食べる' });

    // Step 2: click Filter Media
    mockGetSearchStats.mockResolvedValue(
      makeSearchStatsResponse(
        [
          { publicId: 'media-1', matchCount: 80 },
          { publicId: 'media-2', matchCount: 20 },
        ],
        { 'media-1': media1, 'media-2': media2 },
      ),
    );

    const step2 = await flow.clickButton('filter_media');
    expect(step2.content).toContain('Filter by media');
    expect(step2.content).toContain('Oshi No Ko');
    expect(step2.content).toContain('Spy x Family');
    expect(step2.selectMenus).toContainEqual(expect.objectContaining({ customId: 'filter_media_select' }));

    // Step 3: select Oshi No Ko
    const filteredSeg = makeSegment({
      publicId: 'seg-filtered',
      textJa: { content: '食べたくない', highlight: '<em>食べ</em>たくない' },
      mediaPublicId: 'media-1',
    });
    mockSearch.mockResolvedValue(makeSearchResponse([filteredSeg], { 'media-1': media1 }, { estimatedTotalHits: 80 }));

    const step3 = await flow.selectMenu('filter_media_select', ['media-1']);
    expect(step3.content).toContain('~80 results');
    expect(step3.content).toContain('Oshi No Ko');
    expect(step3.content).toContain('**食べ**たくない');
  });

  test('search with no results shows message', async () => {
    mockSearch.mockResolvedValue(makeSearchResponse([], {}));

    const step = await flow.executeCommand(execute, { query: 'xyznotfound' });

    expect(step.content).toContain('No results found');
    expect(step.content).toContain('xyznotfound');
  });

  test('full flow: random -> search modal -> filter media -> refine search', async () => {
    // Step 1: random mode
    const randomSeg = makeSegment({
      publicId: 'seg-r',
      textJa: { content: '元気ですか' },
      mediaPublicId: 'media-1',
    });
    mockFetchRandom.mockResolvedValue(makeSearchResponse([randomSeg], { 'media-1': media1 }));
    mockGetSearchStats.mockResolvedValue(
      makeSearchStatsResponse([{ publicId: 'media-1', matchCount: 10000 }], { 'media-1': media1 }),
    );

    const step1 = await flow.executeCommand(execute, {});
    expect(step1.content).toContain('元気ですか');

    // Step 2: open search modal
    const step2 = await flow.clickButton('advanced_search');
    expect(step2.modalShown).toBe(true);

    // Step 3: submit search
    const searchSeg1 = makeSegment({
      publicId: 'seg-s1',
      textJa: { content: '食べたい', highlight: '<em>食べ</em>たい' },
      mediaPublicId: 'media-1',
    });
    const searchSeg2 = makeSegment({
      publicId: 'seg-s2',
      textJa: { content: '食べる', highlight: '<em>食べる</em>' },
      mediaPublicId: 'media-2',
    });
    mockSearch.mockResolvedValue(
      makeSearchResponse(
        [searchSeg1, searchSeg2],
        { 'media-1': media1, 'media-2': media2 },
        { estimatedTotalHits: 200 },
      ),
    );

    const step3 = await flow.submitModal({
      search_query: '食べる',
      search_episodes: '',
      search_sort: '',
    });
    expect(step3.content).toContain('~200 results');

    // Step 4: filter media
    mockGetSearchStats.mockResolvedValue(
      makeSearchStatsResponse(
        [
          { publicId: 'media-1', matchCount: 120 },
          { publicId: 'media-2', matchCount: 80 },
        ],
        { 'media-1': media1, 'media-2': media2 },
      ),
    );

    const step4 = await flow.clickButton('filter_media');
    expect(step4.content).toContain('Filter by media');

    // Step 5: select Oshi No Ko
    const filteredSeg = makeSegment({
      publicId: 'seg-f1',
      textJa: { content: '食べて', highlight: '<em>食べ</em>て' },
      mediaPublicId: 'media-1',
      episode: 5,
    });
    mockSearch.mockResolvedValue(makeSearchResponse([filteredSeg], { 'media-1': media1 }, { estimatedTotalHits: 120 }));

    const step5 = await flow.selectMenu('filter_media_select', ['media-1']);
    expect(step5.content).toContain('~120 results');
    expect(step5.content).toContain('Oshi No Ko');

    // Step 6: open search modal again to refine with episode
    const step6 = await flow.clickButton('advanced_search');
    expect(step6.modalShown).toBe(true);

    // Step 7: submit with episode filter
    const episodeSeg = makeSegment({
      publicId: 'seg-ep',
      textJa: { content: '食べたかった', highlight: '<em>食べ</em>たかった' },
      mediaPublicId: 'media-1',
      episode: 3,
    });
    mockSearch.mockResolvedValue(makeSearchResponse([episodeSeg], { 'media-1': media1 }, { estimatedTotalHits: 8 }));

    const step7 = await flow.submitModal({
      search_query: '食べる',
      search_episodes: '3',
      search_sort: '',
    });
    expect(step7.content).toContain('~8 results');
    expect(step7.content).toContain('Ep. 3');
    expect(step7.content).toContain('Oshi No Ko');

    await flow.end();
  });

  test('search -> context -> shows surrounding sentences', async () => {
    const seg = makeSegment({
      publicId: 'seg-1',
      textJa: { content: '食べたい', highlight: '<em>食べ</em>たい' },
      mediaPublicId: 'media-1',
      episode: 3,
    });
    mockSearch.mockResolvedValue(makeSearchResponse([seg], { 'media-1': media1 }, { estimatedTotalHits: 10 }));

    await flow.executeCommand(execute, { query: '食べる' });

    // Click context button
    const ctxBefore = makeSegment({
      publicId: 'ctx-before',
      textJa: { content: 'その前の文' },
      mediaPublicId: 'media-1',
      episode: 3,
      startTimeMs: 57000,
    });
    const ctxAfter = makeSegment({
      publicId: 'ctx-after',
      textJa: { content: 'その後の文' },
      mediaPublicId: 'media-1',
      episode: 3,
      startTimeMs: 63000,
    });
    mockGetSegmentContext.mockResolvedValue(makeContextResponse([ctxBefore, seg, ctxAfter], { 'media-1': media1 }));

    const step2 = await flow.clickButton('context');

    expect(step2.content).toContain('Context');
    expect(step2.content).toContain('Oshi No Ko');
    expect(step2.content).toContain('Episode 3');
    expect(step2.selectMenus).toContainEqual(expect.objectContaining({ customId: 'context_select' }));
    expect(step2.buttons).toContain('back_to_original');
  });

  test('search -> context -> select different sentence', async () => {
    const seg = makeSegment({
      publicId: 'seg-1',
      textJa: { content: '食べたい', highlight: '<em>食べ</em>たい' },
      mediaPublicId: 'media-1',
      episode: 3,
    });
    mockSearch.mockResolvedValue(makeSearchResponse([seg], { 'media-1': media1 }, { estimatedTotalHits: 10 }));

    await flow.executeCommand(execute, { query: '食べる' });

    // Open context
    const ctxBefore = makeSegment({
      publicId: 'ctx-before',
      textJa: { content: 'その前の文' },
      mediaPublicId: 'media-1',
      episode: 3,
      startTimeMs: 57000,
    });
    const ctxAfter = makeSegment({
      publicId: 'ctx-after',
      textJa: { content: 'その後の文' },
      mediaPublicId: 'media-1',
      episode: 3,
      startTimeMs: 63000,
    });
    mockGetSegmentContext.mockResolvedValue(makeContextResponse([ctxBefore, seg, ctxAfter], { 'media-1': media1 }));

    await flow.clickButton('context');

    // Select a different context sentence
    const step3 = await flow.selectMenu('context_select', ['ctx-after']);

    expect(step3.content).toContain('Context');
    expect(step3.content).toContain('その後の文');
    expect(step3.content).toContain('Oshi No Ko');
  });

  test('search -> context -> back to original restores search view', async () => {
    const seg = makeSegment({
      publicId: 'seg-1',
      textJa: { content: '食べたい', highlight: '<em>食べ</em>たい' },
      mediaPublicId: 'media-1',
      episode: 3,
    });
    mockSearch.mockResolvedValue(makeSearchResponse([seg], { 'media-1': media1 }, { estimatedTotalHits: 10 }));

    await flow.executeCommand(execute, { query: '食べる' });

    // Open context
    const ctxSeg = makeSegment({
      publicId: 'ctx-1',
      textJa: { content: 'コンテキスト' },
      mediaPublicId: 'media-1',
      episode: 3,
    });
    mockGetSegmentContext.mockResolvedValue(makeContextResponse([ctxSeg, seg], { 'media-1': media1 }));

    await flow.clickButton('context');

    // Click back to original
    const step3 = await flow.clickButton('back_to_original');

    // Should be back to search results view
    expect(step3.content).toContain('~10 results');
    expect(step3.content).toContain('食べる');
    expect(step3.selectMenus).toContainEqual(expect.objectContaining({ customId: 'search_select' }));
    expect(step3.buttons).toContain('context');
    expect(step3.buttons).not.toContain('back_to_original');
  });

  test('random -> context -> back to original restores segment view', async () => {
    const seg = makeSegment({
      publicId: 'seg-r',
      textJa: { content: 'ランダムな文' },
      mediaPublicId: 'media-1',
      episode: 5,
    });
    mockFetchRandom.mockResolvedValue(makeSearchResponse([seg], { 'media-1': media1 }));
    mockGetSearchStats.mockResolvedValue(
      makeSearchStatsResponse([{ publicId: 'media-1', matchCount: 3000 }], { 'media-1': media1 }),
    );

    await flow.executeCommand(execute, {});

    // Open context
    const ctxSeg = makeSegment({
      publicId: 'ctx-1',
      textJa: { content: 'コンテキスト文' },
      mediaPublicId: 'media-1',
      episode: 5,
    });
    mockGetSegmentContext.mockResolvedValue(makeContextResponse([ctxSeg, seg], { 'media-1': media1 }));

    const step2 = await flow.clickButton('context');
    expect(step2.content).toContain('Context');

    // Back to original
    const step3 = await flow.clickButton('back_to_original');

    expect(step3.content).toContain('ランダムな文');
    expect(step3.content).toContain('3,000');
    expect(step3.buttons).toContain('context');
    expect(step3.buttons).not.toContain('back_to_original');
  });
});
