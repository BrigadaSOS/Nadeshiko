import { describe, test, expect, beforeEach } from 'vitest';
// Importing the mocks registers them; it has to come before the command handler.
import { resetApiMocks, mockGetSegmentByUuid, mockGetSegmentContext, mockDownloadFile } from '../mocks/api';

import { execute, parseSegmentId } from '../../commands/sentence';
import { FlowRunner } from '../harness/flow';
import { makeSegment, makeMedia, makeContextResponse } from '../mocks/fixtures';

const media = makeMedia({ publicId: 'media-1', nameRomaji: 'Oshi No Ko', nameJa: '推しの子' });

/**
 * `/sentence` accepts whatever a reader has in their clipboard, which in
 * practice is a URL copied out of the site rather than a bare id. Every shape
 * below is one somebody will paste.
 */
describe('parseSegmentId', () => {
  test('passes a bare id through, trimmed', () => {
    expect(parseSegmentId('gFH5xlsT--zr')).toBe('gFH5xlsT--zr');
    expect(parseSegmentId('  gFH5xlsT--zr  ')).toBe('gFH5xlsT--zr');
  });

  test.each(['', 'en/', 'es/', 'ja/'])('pulls the id out of a /%ssentence/ url', (locale) => {
    expect(parseSegmentId(`https://nadeshiko.co/${locale}sentence/gFH5xlsT--zr`)).toBe('gFH5xlsT--zr');
  });

  test('survives the things a real paste carries', () => {
    // A tracking query string, http, the staging host, and a url sitting inside
    // a sentence someone typed around it.
    expect(parseSegmentId('https://nadeshiko.co/en/sentence/abc123?utm_source=discord')).toBe('abc123');
    expect(parseSegmentId('http://nadeshiko.co/en/sentence/abc123')).toBe('abc123');
    expect(parseSegmentId('https://stg.nadeshiko.co/en/sentence/abc123')).toBe('abc123');
    expect(parseSegmentId('look at https://nadeshiko.co/sentence/abc123 neat')).toBe('abc123');
  });

  test('does not recognise a locale the site does not serve', () => {
    // The locale list is spelled into the regex, so it is a second copy of the
    // one in nuxt.config.ts. A locale added to the site and forgotten here
    // silently stops URL pastes working for that locale -- it falls through as
    // a literal id and 404s against the API.
    const url = 'https://nadeshiko.co/fr/sentence/abc123';
    expect(parseSegmentId(url)).toBe(url);
  });

  test('leaves an empty string alone rather than inventing an id', () => {
    expect(parseSegmentId('')).toBe('');
  });
});

describe('/sentence flow', () => {
  let flow: FlowRunner;
  const segment = makeSegment({
    publicId: 'seg-1',
    episode: 3,
    mediaPublicId: 'media-1',
    textJa: { content: '食べたい', highlight: '' },
  });

  beforeEach(() => {
    flow = new FlowRunner();
    resetApiMocks();
    mockDownloadFile.mockResolvedValue(null);
    mockGetSegmentByUuid.mockResolvedValue({ segment, media });
  });

  test('renders the sentence with the media and episode it came from', async () => {
    const result = await flow.executeCommand(execute, { id: 'seg-1' });

    expect(result.content).toContain('食べたい');
    expect(result.content).toContain('Oshi No Ko');
    expect(result.content).toContain('Episode 3');
  });

  test('resolves a pasted url before asking the API for it', async () => {
    await flow.executeCommand(execute, { id: 'https://nadeshiko.co/ja/sentence/seg-1' });

    expect(mockGetSegmentByUuid).toHaveBeenCalledWith('seg-1');
  });

  test('offers context and both search-in buttons when the media is known', async () => {
    const result = await flow.executeCommand(execute, { id: 'seg-1' });

    expect(result.buttons).toContain('context');
    expect(result.buttons).toContain('search_in_media');
    expect(result.buttons).toContain('search_in_episode');
  });

  test('drops the search-in buttons when the segment has no media', async () => {
    // Nothing to scope a search to, so offering it would open a dead end.
    mockGetSegmentByUuid.mockResolvedValue({ segment, media: null });

    const result = await flow.executeCommand(execute, { id: 'seg-1' });

    expect(result.buttons).not.toContain('search_in_media');
    expect(result.buttons).not.toContain('search_in_episode');
  });

  test('opens context as a picker of the surrounding lines', async () => {
    // Context is a select menu, not a wall of text: the reader picks a
    // neighbouring line and the reply swaps to it, which keeps one sentence on
    // screen at a time.
    const neighbours = [
      makeSegment({ publicId: 'a', episode: 3, textJa: { content: '一', highlight: '' } }),
      segment,
      makeSegment({ publicId: 'c', episode: 3, textJa: { content: '三', highlight: '' } }),
    ];
    mockGetSegmentContext.mockResolvedValue(makeContextResponse(neighbours, { 'media-1': media }));

    await flow.executeCommand(execute, { id: 'seg-1' });
    const result = await flow.clickButton('context');

    expect(result.content).toContain('Context');
    expect(result.buttons).toContain('back_to_original');

    const picker = result.selectMenus.find((m) => m.customId === 'context_select');
    expect(picker?.options.map((o) => o.value)).toEqual(['a', 'seg-1', 'c']);
  });

  test('labels each neighbour by its offset from the sentence you started on', async () => {
    const neighbours = [
      makeSegment({ publicId: 'a', episode: 3, textJa: { content: '一', highlight: '' } }),
      segment,
      makeSegment({ publicId: 'c', episode: 3, textJa: { content: '三', highlight: '' } }),
    ];
    mockGetSegmentContext.mockResolvedValue(makeContextResponse(neighbours, { 'media-1': media }));

    await flow.executeCommand(execute, { id: 'seg-1' });
    const result = await flow.clickButton('context');
    const labels = result.selectMenus.find((m) => m.customId === 'context_select')?.options.map((o) => o.label);

    expect(labels).toEqual(['-1) 一', '▶) 食べたい', '+1) 三']);
  });

  test('picking a neighbour swaps the reply to that line', async () => {
    const neighbours = [makeSegment({ publicId: 'a', episode: 3, textJa: { content: '一', highlight: '' } }), segment];
    mockGetSegmentContext.mockResolvedValue(makeContextResponse(neighbours, { 'media-1': media }));

    await flow.executeCommand(execute, { id: 'seg-1' });
    await flow.clickButton('context');
    const result = await flow.selectMenu('context_select', ['a']);

    expect(result.content).toContain('一');
  });

  test('returns to the single sentence when context is closed', async () => {
    const neighbours = [segment, makeSegment({ publicId: 'c', episode: 3, textJa: { content: '三', highlight: '' } })];
    mockGetSegmentContext.mockResolvedValue(makeContextResponse(neighbours, { 'media-1': media }));

    await flow.executeCommand(execute, { id: 'seg-1' });
    await flow.clickButton('context');
    const result = await flow.clickButton('back_to_original');

    expect(result.content).toContain('食べたい');
    expect(result.buttons).toContain('context');
  });

  test('says so plainly when the id matches nothing', async () => {
    mockGetSegmentByUuid.mockRejectedValue(new Error('404 not found'));

    const result = await flow.executeCommand(execute, { id: 'nope' });

    // The reader gets a message, not a silent failure or a raw stack.
    expect(result.content).toBeTruthy();
    expect(result.content).not.toContain('食べたい');
    expect(result.content?.toLowerCase()).not.toContain('stack');
  });
});
