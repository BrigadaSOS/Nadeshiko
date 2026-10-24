import { afterAll, beforeAll, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import * as schemas from 'generated/schemas';
import { search, getSearchStats, searchWords } from '@app/controllers/searchController';
import { SegmentDocument } from '@app/services/search/SegmentDocument';
import { assertMatchesSchema } from '../helpers/openapiContract';
import { ApiKeyKind, AuthType } from '@app/models/ApiPermission';
import { UserRoleType } from '@app/models/User';
import type { MediaOutput } from 'generated/outputTypes';

let mockSearch: Mock<typeof SegmentDocument.search>;
let mockSearchStats: Mock<typeof SegmentDocument.searchStats>;
let mockWordsMatched: Mock<typeof SegmentDocument.wordsMatched>;

function buildMediaRecord(id: number): MediaOutput {
  const publicId = `Media${String(id).padStart(7, '0')}`;
  return {
    publicId,
    slug: `media-${id}`,
    externalIds: {
      anilist: null,
      imdb: null,
      tvdb: null,
      tmdb: null,
      youtube: null,
    },
    nameJa: `media-${id}-ja`,
    nameRomaji: `media-${id}-romaji`,
    nameEn: `media-${id}-en`,
    airingFormat: 'TV',
    airingStatus: 'FINISHED',
    genres: ['Action'],
    coverUrl: `https://example.test/${id}/cover.webp`,
    bannerUrl: `https://example.test/${id}/banner.webp`,
    startDate: '2024-01-01',
    endDate: null,
    category: 'ANIME' as const,
    segmentCount: 1,
    episodeCount: 1,
    studio: 'Studio',
    seasonName: 'WINTER',
    seasonYear: 2024,
  };
}

function responder200() {
  return {
    with200: () => ({
      body: (body: unknown) => ({ status: 200 as const, body }),
    }),
  };
}

async function invoke(handler: any, input: unknown, req?: unknown) {
  const response = await handler(input, responder200() as any, req as any, {} as any, (() => {}) as any);
  if (response && typeof response === 'object' && 'unpack' in response) {
    return (response as { unpack(): { status: number; body: unknown } }).unpack();
  }
  return response as { status: number; body: unknown };
}

beforeAll(() => {
  mockSearch = vi.spyOn(SegmentDocument, 'search') as any;
  mockSearchStats = vi.spyOn(SegmentDocument, 'searchStats') as any;
  mockWordsMatched = vi.spyOn(SegmentDocument, 'wordsMatched') as any;
});

afterAll(() => {
  mockSearch.mockRestore();
  mockSearchStats.mockRestore();
  mockWordsMatched.mockRestore();
});

beforeEach(() => {
  mockSearch.mockReset();
  mockSearchStats.mockReset();
  mockWordsMatched.mockReset();
});

describe('search controller', () => {
  it('returns search results', async () => {
    mockSearch.mockResolvedValue({
      segments: [],
      includes: { media: { 1: buildMediaRecord(1) } },
      pagination: { hasMore: false, cursor: null, estimatedTotalHits: 1, estimatedTotalHitsRelation: 'EXACT' },
    });

    const res = await invoke(
      search as any,
      {
        body: {
          query: { search: '猫', exactMatch: false },
          filters: { status: ['ACTIVE'], category: ['ANIME'] },
          include: ['media'],
          take: 10,
        },
      } as any,
      { user: { id: 1001, preferences: {} } } as any,
    );

    expect(res.status).toBe(200);
    expect((res.body as any).includes.media['1']).toMatchObject({ publicId: 'Media0000001' });
    expect(mockSearch).toHaveBeenCalledTimes(1);
    assertMatchesSchema(schemas.s_SearchResponse, res.body, 'search() 200');
  });

  it('does not include media when include is empty', async () => {
    mockSearch.mockResolvedValue({
      segments: [],
      includes: { media: { 2: buildMediaRecord(2) } },
      pagination: { hasMore: true, cursor: 'next-cursor', estimatedTotalHits: 2, estimatedTotalHitsRelation: 'EXACT' },
    });

    const res = await invoke(
      search as any,
      {
        body: {
          query: { search: '犬', exactMatch: false },
          cursor: 'existing-cursor',
          include: [],
          filters: { status: ['ACTIVE'], category: ['ANIME'] },
          take: 10,
        },
      } as any,
      { user: { id: 1001, preferences: {} } } as any,
    );

    expect(res.status).toBe(200);
    expect((res.body as any).includes).toBeUndefined();
  });

  it('search stats strips includes by default', async () => {
    mockSearchStats.mockResolvedValue({
      media: [{ mediaPublicId: 'pub1', matchCount: 2, episodeHits: [{ episode: 1, hitCount: 2 }] }],
      categories: [{ category: 'ANIME', count: 2, realCount: 2 }],
      includes: { media: { 1: buildMediaRecord(1) } },
    });

    const res = await invoke(
      getSearchStats as any,
      {
        body: { query: { exactMatch: false }, filters: { status: ['ACTIVE'], category: ['ANIME'] }, include: [] },
      } as any,
      { user: { id: 1001, preferences: {} } } as any,
    );

    expect(res.status).toBe(200);
    expect((res.body as any).includes).toBeUndefined();
    expect(mockSearchStats).toHaveBeenCalledTimes(1);
  });

  it('search words passes inputs and strips includes by default', async () => {
    mockWordsMatched.mockResolvedValue({
      results: [
        {
          word: '猫',
          isMatch: true,
          matchCount: 3,
          realMatchCount: 5,
          media: [{ mediaPublicId: 'Media0000001', matchCount: 3 }],
        },
      ],
      includes: { media: { 1: buildMediaRecord(1) } },
    });

    const res = await invoke(
      searchWords as any,
      {
        body: {
          query: { words: ['猫'], exactMatch: true },
          include: [],
          filters: { status: ['ACTIVE'], category: ['ANIME'] },
        },
      } as any,
      { user: { id: 1001, preferences: {} } } as any,
    );

    expect(res.status).toBe(200);
    expect((res.body as any).includes).toBeUndefined();
    assertMatchesSchema(schemas.s_SearchMultipleResponse, res.body, 'searchWords() 200');
    expect(mockWordsMatched).toHaveBeenCalledWith(
      ['猫'],
      true,
      expect.objectContaining({ status: ['ACTIVE'], category: ['ANIME'] }),
    );
  });
});

describe('segment status clamping', () => {
  const emptySearch = {
    segments: [],
    includes: { media: {} },
    pagination: { hasMore: false, cursor: null, estimatedTotalHits: 0, estimatedTotalHitsRelation: 'EXACT' },
  };
  const adminSession = { user: { id: 1, role: UserRoleType.ADMIN }, auth: { type: AuthType.SESSION } };
  const callers = {
    // The frontend proxy searches on behalf of every visitor with its master key.
    'a service key': {
      user: { id: 2, role: UserRoleType.USER },
      auth: { type: AuthType.API_KEY, apiKey: { kind: ApiKeyKind.SERVICE, permissions: [] } },
    },
    'an admin-owned API key': {
      user: { id: 1, role: UserRoleType.ADMIN },
      auth: { type: AuthType.API_KEY, apiKey: { kind: ApiKeyKind.USER, permissions: [] } },
    },
    'a non-admin session': { user: { id: 3, role: UserRoleType.USER }, auth: { type: AuthType.SESSION } },
  };

  for (const [label, req] of Object.entries(callers)) {
    it(`forces ACTIVE for ${label} asking for hidden and deleted segments`, async () => {
      mockSearch.mockResolvedValue(emptySearch as any);

      await invoke(
        search as any,
        { body: { filters: { status: ['HIDDEN', 'DELETED'], category: ['ANIME'] }, include: [], take: 10 } },
        req,
      );

      expect(mockSearch.mock.calls[0]![0].filters).toMatchObject({ status: ['ACTIVE'], category: ['ANIME'] });
    });
  }

  it('lets an admin session search hidden segments', async () => {
    mockSearchStats.mockResolvedValue({ media: [], categories: [], includes: { media: {} } } as any);

    await invoke(getSearchStats as any, { body: { filters: { status: ['HIDDEN'] }, include: [] } }, adminSession);

    expect(mockSearchStats.mock.calls[0]![0].filters).toMatchObject({ status: ['HIDDEN'] });
  });

  it('scopes an unfiltered word search to ACTIVE rather than every status', async () => {
    mockWordsMatched.mockResolvedValue({ results: [], includes: { media: {} } } as any);

    await invoke(
      searchWords as any,
      { body: { query: { words: ['猫'], exactMatch: true }, include: [] } },
      callers['a service key'],
    );

    expect(mockWordsMatched).toHaveBeenCalledWith(['猫'], true, { status: ['ACTIVE'] });
  });
});
