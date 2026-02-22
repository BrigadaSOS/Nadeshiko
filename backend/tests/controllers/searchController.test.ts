import request from 'supertest';
import { beforeAll, beforeEach, describe, expect, it, vi, type Mock } from 'bun:test';
import type { Application, Request, Response, NextFunction } from 'express';
import { buildApplication } from '@config/application';
import { SearchRoutes } from '@app/routes/router';
import { SegmentDocument } from '@app/models/SegmentDocument';
import { UserActivity, ActivityType } from '@app/models/UserActivity';

let app: Application;
let mockSearch: Mock<typeof SegmentDocument.search>;
let mockSearchStats: Mock<typeof SegmentDocument.searchStats>;
let mockWordsMatched: Mock<typeof SegmentDocument.wordsMatched>;
let mockTrackForUser: Mock<typeof UserActivity.trackForUser>;

function signInAs(targetApp: Application, user: Record<string, unknown> | null) {
  targetApp.locals.testUser = user;
}

function testAuthMiddleware(req: Request, _res: Response, next: NextFunction) {
  if (req.app.locals.testUser) {
    req.user = req.app.locals.testUser as any;
  }
  next();
}

function buildMediaRecord(id: number) {
  return {
    id,
    externalIds: {},
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
    category: 'ANIME',
    segmentCount: 1,
    episodeCount: 1,
    studio: 'Studio',
    seasonName: 'WINTER',
    seasonYear: 2024,
    characters: [],
  };
}

beforeAll(() => {
  mockSearch = vi.spyOn(SegmentDocument, 'search') as any;
  mockSearchStats = vi.spyOn(SegmentDocument, 'searchStats') as any;
  mockWordsMatched = vi.spyOn(SegmentDocument, 'wordsMatched') as any;
  mockTrackForUser = vi.spyOn(UserActivity, 'trackForUser') as any;

  app = buildApplication({
    beforeRoutes: [testAuthMiddleware],
    mountRoutes: (instance) => {
      instance.use('/', SearchRoutes);
    },
  });
});

beforeEach(() => {
  mockSearch.mockReset();
  mockSearchStats.mockReset();
  mockWordsMatched.mockReset();
  mockTrackForUser.mockReset();
  mockTrackForUser.mockResolvedValue(undefined);
  signInAs(app, { id: 1001, preferences: {} });
});

describe('POST /v1/search', () => {
  it('returns search results and tracks initial searches', async () => {
    mockSearch.mockResolvedValue({
      segments: [],
      includes: { media: { 1: buildMediaRecord(1) } },
      pagination: { hasMore: false, cursor: null },
    });

    const res = await request(app).post('/v1/search').send({
      query: { search: '猫' },
      filters: { status: ['ACTIVE'], category: ['ANIME'] },
    });

    expect(res.status).toBe(200);
    expect(res.body.includes.media['1']).toMatchObject({ id: 1 });
    expect(mockSearch).toHaveBeenCalledTimes(1);
    expect(mockTrackForUser).toHaveBeenCalledTimes(1);
    expect(mockTrackForUser).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1001 }),
      ActivityType.SEARCH,
      { searchQuery: '猫' },
    );
  });

  it('does not track paginated requests and strips includes when include is empty', async () => {
    mockSearch.mockResolvedValue({
      segments: [],
      includes: { media: { 2: buildMediaRecord(2) } },
      pagination: { hasMore: true, cursor: 'next-cursor' },
    });

    const res = await request(app).post('/v1/search').send({
      query: { search: '犬' },
      cursor: 'existing-cursor',
      include: [],
      filters: { status: ['ACTIVE'], category: ['ANIME'] },
    });

    expect(res.status).toBe(200);
    expect(res.body.includes).toEqual({ media: {} });
    expect(mockTrackForUser).not.toHaveBeenCalled();
  });

  it('does not track when user is missing', async () => {
    signInAs(app, null);
    mockSearch.mockResolvedValue({
      segments: [],
      includes: { media: { 3: buildMediaRecord(3) } },
      pagination: { hasMore: false, cursor: null },
    });

    const res = await request(app).post('/v1/search').send({
      query: { search: '鳥' },
      filters: { status: ['ACTIVE'], category: ['ANIME'] },
    });

    expect(res.status).toBe(200);
    expect(mockTrackForUser).not.toHaveBeenCalled();
  });

  it('silently swallows tracking errors', async () => {
    mockTrackForUser.mockRejectedValue(new Error('tracking failed'));
    mockSearch.mockResolvedValue({
      segments: [],
      includes: { media: {} },
      pagination: { hasMore: false, cursor: null },
    });

    const res = await request(app).post('/v1/search').send({
      query: { search: '猫' },
      filters: { status: ['ACTIVE'], category: ['ANIME'] },
    });

    expect(res.status).toBe(200);
    expect(mockTrackForUser).toHaveBeenCalledTimes(1);
  });
});

describe('POST /v1/search/stats', () => {
  it('strips includes by default', async () => {
    mockSearchStats.mockResolvedValue({
      media: [{ mediaId: 1, matchCount: 2, episodeHits: { 1: 2 } }],
      categories: [{ category: 'ANIME', count: 2 }],
      includes: { media: { 1: buildMediaRecord(1) } },
    });

    const res = await request(app).post('/v1/search/stats').send({
      filters: { status: ['ACTIVE'], category: ['ANIME'] },
    });

    expect(res.status).toBe(200);
    expect(res.body.includes).toEqual({ media: {} });
    expect(mockSearchStats).toHaveBeenCalledTimes(1);
  });

  it('keeps includes when requested', async () => {
    mockSearchStats.mockResolvedValue({
      media: [{ mediaId: 1, matchCount: 2, episodeHits: { 1: 2 } }],
      categories: [{ category: 'ANIME', count: 2 }],
      includes: { media: { 1: buildMediaRecord(1) } },
    });

    const res = await request(app).post('/v1/search/stats').send({
      include: ['media'],
      filters: { status: ['ACTIVE'], category: ['ANIME'] },
    });

    expect(res.status).toBe(200);
    expect(res.body.includes.media['1']).toMatchObject({ id: 1 });
  });
});

describe('POST /v1/search/words', () => {
  it('passes words search inputs and strips includes by default', async () => {
    mockWordsMatched.mockResolvedValue({
      results: [{ word: '猫', isMatch: true, matchCount: 3, media: [{ mediaId: 1, matchCount: 3 }] }],
      includes: { media: { 1: buildMediaRecord(1) } },
    });

    const res = await request(app).post('/v1/search/words').send({
      query: { words: ['猫'], exactMatch: true },
      filters: { status: ['ACTIVE'], category: ['ANIME'] },
    });

    expect(res.status).toBe(200);
    expect(res.body.includes).toEqual({ media: {} });
    expect(mockWordsMatched).toHaveBeenCalledWith(
      ['猫'],
      true,
      expect.objectContaining({ status: ['ACTIVE'], category: ['ANIME'] }),
    );
  });

  it('keeps includes when requested', async () => {
    mockWordsMatched.mockResolvedValue({
      results: [{ word: '犬', isMatch: false, matchCount: 0, media: [] }],
      includes: { media: { 2: buildMediaRecord(2) } },
    });

    const res = await request(app).post('/v1/search/words').send({
      query: { words: ['犬'] },
      include: ['media'],
      filters: { status: ['ACTIVE'], category: ['ANIME'] },
    });

    expect(res.status).toBe(200);
    expect(res.body.includes.media['2']).toMatchObject({ id: 2 });
  });
});
