import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { In, Like } from 'typeorm';
import * as schemas from 'generated/schemas';
import { CategoryType, Media, Segment } from '@app/models';
import { SegmentDocument } from '@app/services/search/SegmentDocument';
import { SegmentIndexer } from '@app/services/search/segmentDocument/SegmentIndexer';
import { client, INDEX_NAME } from '@config/elasticsearch';
import { Cache } from '@lib/cache';
import { MEDIA_INFO_CACHE } from '@app/models/Media';
import { assertMatchesSchema } from '../helpers/openapiContract';
import { isEsAvailable, seedSegmentsIntoEs } from '../helpers/esFixtures';
import * as esSyncQueue from '@app/workers/esSyncQueue';
import { createTestApp, setupTestSuite, type TestServer } from '../helpers/setup';

type LanguageFilter = string[] | { exclude: string[] } | undefined;
type FixtureSegment = Awaited<ReturnType<typeof seedSegmentsIntoEs>>['segments'][number];

const SEARCH_WORD = `languagecompatprobe${Date.now()}`;
const MISSING_WORD = `${SEARCH_WORD}missing`;
const FIXTURE_SLUG_PREFIX = `language-integration-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

function searchBody(languages: LanguageFilter) {
  return {
    query: { search: SEARCH_WORD, exactMatch: false },
    sort: { mode: 'TIME_ASC' },
    take: 10,
    filters: languages === undefined ? undefined : { languages },
    include: ['media'],
  };
}

function statsBody(languages: LanguageFilter) {
  return {
    query: { search: SEARCH_WORD, exactMatch: false },
    filters: languages === undefined ? undefined : { languages },
    include: ['media'],
  };
}

function wordsBody(languages: LanguageFilter) {
  return {
    query: { words: [SEARCH_WORD, MISSING_WORD], exactMatch: false },
    filters: languages === undefined ? undefined : { languages },
    include: ['media'],
  };
}

describe('search language compatibility (real HTTP/Postgres/Elasticsearch)', () => {
  setupTestSuite();

  let server: TestServer;
  let sendEsSyncJob: ReturnType<typeof vi.spyOn>;
  const trackedSegmentIds = new Set<number>();
  let fixtureMedia: Awaited<ReturnType<typeof seedSegmentsIntoEs>>['media'][] = [];
  let fixtureSegments: FixtureSegment[] = [];

  beforeAll(async () => {
    if (!(await isEsAvailable())) {
      throw new Error(
        `Elasticsearch is unavailable for the real language integration suite; refusing to skip. Target index: ${INDEX_NAME}`,
      );
    }

    sendEsSyncJob = vi.spyOn(esSyncQueue, 'sendEsSyncJob').mockResolvedValue(null);
    server = createTestApp();
  });

  afterAll(() => {
    sendEsSyncJob?.mockRestore();
  });

  async function seedFixture(): Promise<void> {
    const rows = [
      {
        name: 'english',
        category: CategoryType.ANIME,
        japanese: '言語互換の固有文一',
        english: `${SEARCH_WORD} english-only`,
        spanish: 'spanish distractor one',
      },
      {
        name: 'spanish',
        category: CategoryType.JDRAMA,
        japanese: '言語互換の固有文二',
        english: 'english distractor two',
        spanish: `${SEARCH_WORD} spanish-only`,
      },
      {
        name: 'both',
        category: CategoryType.ANIME,
        japanese: '言語互換の固有文三',
        english: `${SEARCH_WORD} english-and-spanish`,
        spanish: `${SEARCH_WORD} spanish-and-english`,
      },
    ];

    for (const row of rows) {
      const seeded = await seedSegmentsIntoEs(
        {
          slug: `${FIXTURE_SLUG_PREFIX}-${row.name}`,
          category: row.category,
        },
        [
          {
            contentJa: row.japanese,
            contentEn: row.english,
            contentEs: row.spanish,
            position: 1,
          },
        ],
      );
      fixtureMedia.push(seeded.media);
      fixtureSegments.push(...seeded.segments);
      for (const segment of seeded.segments) trackedSegmentIds.add(segment.id);
    }
  }

  async function cleanupFixture(): Promise<void> {
    // Recover rows from the transaction if seedSegmentsIntoEs failed after saving/indexing a row but before returning it.
    const mediaRows = await Media.find({
      select: { id: true },
      where: { slug: Like(`${FIXTURE_SLUG_PREFIX}-%`) },
    });
    if (mediaRows.length > 0) {
      const segmentRows = await Segment.find({
        select: { id: true },
        where: { mediaId: In(mediaRows.map((media) => media.id)) },
      });
      for (const segment of segmentRows) trackedSegmentIds.add(segment.id);
    }

    const failedDeletes: number[] = [];
    try {
      for (const segmentId of trackedSegmentIds) {
        if (!(await SegmentIndexer.delete(segmentId))) failedDeletes.push(segmentId);
      }
      await client.indices.refresh({ index: INDEX_NAME });
    } finally {
      Cache.invalidate(MEDIA_INFO_CACHE);
      Cache.invalidate(SegmentDocument.SEARCH_STATS_CACHE);
      fixtureMedia = [];
      fixtureSegments = [];
      trackedSegmentIds.clear();
    }
    if (failedDeletes.length > 0) {
      throw new Error(`Failed to delete scoped Elasticsearch fixture documents: ${failedDeletes.join(', ')}`);
    }
  }

  it('preserves search, stats, and word counts across canonical and legacy language filters', async () => {
    try {
      await seedFixture();

      const english = fixtureSegments[0];
      const spanish = fixtureSegments[1];
      const both = fixtureSegments[2];
      const englishMedia = fixtureMedia[0];
      const spanishMedia = fixtureMedia[1];
      const bothMedia = fixtureMedia[2];
      if (!english || !spanish || !both || !englishMedia || !spanishMedia || !bothMedia) {
        throw new Error('language fixture did not produce the expected three media and segments');
      }

      const searchCases: Array<{ name: string; languages: LanguageFilter; ids: string[] }> = [
        {
          name: 'default all translations',
          languages: undefined,
          ids: [english.publicId, spanish.publicId, both.publicId],
        },
        { name: 'canonical EN only', languages: ['EN'], ids: [english.publicId, both.publicId] },
        { name: 'canonical ES only', languages: ['ES'], ids: [spanish.publicId, both.publicId] },
        { name: 'canonical Japanese only', languages: [], ids: [] },
        { name: 'legacy excludes EN', languages: { exclude: ['en'] }, ids: [spanish.publicId, both.publicId] },
        { name: 'legacy excludes ES', languages: { exclude: ['es'] }, ids: [english.publicId, both.publicId] },
        { name: 'legacy excludes both translations', languages: { exclude: ['en', 'es'] }, ids: [] },
      ];

      for (const testCase of searchCases) {
        const response = await request(server).post('/v1/search').send(searchBody(testCase.languages));
        expect(response.status, testCase.name).toBe(200);
        assertMatchesSchema(schemas.s_SearchResponse, response.body, `search ${testCase.name}`);
        expect(
          response.body.segments.map((segment: { publicId: string }) => segment.publicId),
          testCase.name,
        ).toEqual(testCase.ids);
        const expectedMediaIds = testCase.ids.map((segmentPublicId) => {
          const segment = fixtureSegments.find((candidate) => candidate.publicId === segmentPublicId);
          return fixtureMedia.find((media) => media.id === segment?.mediaId)?.publicId;
        });
        expect(Object.keys(response.body.includes.media), testCase.name).toEqual(expectedMediaIds);

        if (testCase.name === 'canonical EN only') {
          expect(response.body.segments.map((segment: any) => segment.textEn.highlight)).toEqual([
            expect.stringContaining(`<em>${SEARCH_WORD}</em>`),
            expect.stringContaining(`<em>${SEARCH_WORD}</em>`),
          ]);
          expect(response.body.segments.map((segment: any) => segment.textEs.highlight)).toEqual([null, null]);
        }
        if (testCase.name === 'canonical ES only') {
          expect(response.body.segments.map((segment: any) => segment.textEs.highlight)).toEqual([
            expect.stringContaining(`<em>${SEARCH_WORD}</em>`),
            expect.stringContaining(`<em>${SEARCH_WORD}</em>`),
          ]);
          expect(response.body.segments.map((segment: any) => segment.textEn.highlight)).toEqual([null, null]);
        }
      }

      const exactLegacyResponse = await request(server)
        .post('/v1/search')
        .send({
          query: { search: SEARCH_WORD, exactMatch: true },
          sort: { mode: 'TIME_ASC' },
          filters: { languages: { exclude: ['es'] } },
          include: ['media'],
        });
      expect(exactLegacyResponse.status).toBe(200);
      assertMatchesSchema(schemas.s_SearchResponse, exactLegacyResponse.body, 'exact search with legacy ES exclusion');
      expect(exactLegacyResponse.body.segments.map((segment: { publicId: string }) => segment.publicId)).toEqual([
        english.publicId,
        both.publicId,
      ]);

      const japaneseResponse = await request(server)
        .post('/v1/search')
        .send({
          query: { search: '固有文二', exactMatch: false },
          sort: { mode: 'TIME_ASC' },
          filters: { languages: [] },
          include: ['media'],
        });
      expect(japaneseResponse.status).toBe(200);
      assertMatchesSchema(schemas.s_SearchResponse, japaneseResponse.body, 'Japanese retained with no translations');
      expect(japaneseResponse.body.segments.map((segment: { publicId: string }) => segment.publicId)).toEqual([
        spanish.publicId,
      ]);
      expect(japaneseResponse.body.segments[0]?.textJa.highlight).toContain('<em>固有文二</em>');

      const endpointCases: Array<{
        name: string;
        languages: LanguageFilter;
        ids: string[];
        categories: Array<{ category: string; count: number; realCount: number }>;
        wordMatchCount: number;
      }> = [
        {
          name: 'all',
          languages: undefined,
          ids: [englishMedia.publicId, spanishMedia.publicId, bothMedia.publicId],
          categories: [
            { category: 'ANIME', count: 2, realCount: 2 },
            { category: 'JDRAMA', count: 1, realCount: 1 },
          ],
          wordMatchCount: 3,
        },
        {
          name: 'EN',
          languages: ['EN'],
          ids: [englishMedia.publicId, bothMedia.publicId],
          categories: [{ category: 'ANIME', count: 2, realCount: 2 }],
          wordMatchCount: 2,
        },
        {
          name: 'ES',
          languages: ['ES'],
          ids: [spanishMedia.publicId, bothMedia.publicId],
          categories: [
            { category: 'ANIME', count: 1, realCount: 1 },
            { category: 'JDRAMA', count: 1, realCount: 1 },
          ],
          wordMatchCount: 2,
        },
        { name: 'none', languages: [], ids: [], categories: [], wordMatchCount: 0 },
        {
          name: 'legacy excludes EN',
          languages: { exclude: ['en'] },
          ids: [spanishMedia.publicId, bothMedia.publicId],
          categories: [
            { category: 'ANIME', count: 1, realCount: 1 },
            { category: 'JDRAMA', count: 1, realCount: 1 },
          ],
          wordMatchCount: 2,
        },
        {
          name: 'legacy excludes ES',
          languages: { exclude: ['es'] },
          ids: [englishMedia.publicId, bothMedia.publicId],
          categories: [{ category: 'ANIME', count: 2, realCount: 2 }],
          wordMatchCount: 2,
        },
        {
          name: 'legacy excludes both translations',
          languages: { exclude: ['en', 'es'] },
          ids: [],
          categories: [],
          wordMatchCount: 0,
        },
      ];

      // Preserve response order: terms buckets sort by count descending, then key ascending.
      // Each media has one hit, so increasing fixture media IDs break ties; categories use their string keys.
      for (const testCase of endpointCases) {
        Cache.invalidate(SegmentDocument.SEARCH_STATS_CACHE);
        const statsResponse = await request(server).post('/v1/search/stats').send(statsBody(testCase.languages));
        expect(statsResponse.status, `stats ${testCase.name}`).toBe(200);
        assertMatchesSchema(schemas.s_SearchStatsResponse, statsResponse.body, `stats ${testCase.name}`);
        expect(statsResponse.body.media, `stats ${testCase.name}`).toEqual(
          testCase.ids.map((mediaPublicId) => ({
            mediaPublicId,
            matchCount: 1,
            episodeHits: [{ episode: 1, hitCount: 1 }],
          })),
        );
        expect(statsResponse.body.categories, `stats ${testCase.name}`).toEqual(testCase.categories);
        expect(Object.keys(statsResponse.body.includes.media), `stats includes ${testCase.name}`).toEqual(testCase.ids);

        const wordsResponse = await request(server).post('/v1/search/words').send(wordsBody(testCase.languages));
        expect(wordsResponse.status, `words ${testCase.name}`).toBe(200);
        assertMatchesSchema(schemas.s_SearchMultipleResponse, wordsResponse.body, `words ${testCase.name}`);
        expect(wordsResponse.body.results, `words ${testCase.name}`).toEqual([
          {
            word: SEARCH_WORD,
            isMatch: testCase.wordMatchCount > 0,
            matchCount: testCase.wordMatchCount,
            realMatchCount: testCase.wordMatchCount,
            media: testCase.ids.map((mediaPublicId) => ({ mediaPublicId, matchCount: 1 })),
          },
          { word: MISSING_WORD, isMatch: false, matchCount: 0, realMatchCount: 0, media: [] },
        ]);
        expect(Object.keys(wordsResponse.body.includes.media), `words includes ${testCase.name}`).toEqual(testCase.ids);
      }

      for (const [name, languages] of [
        ['canonical lowercase is rejected', ['en']],
        ['unknown canonical language is rejected', ['DE']],
        ['unknown legacy language is rejected', { exclude: ['de'] }],
      ] as const) {
        const invalidResponse = await request(server)
          .post('/v1/search')
          .send({ query: { search: SEARCH_WORD }, filters: { languages }, include: [] });
        expect(invalidResponse.status, name).toBe(400);
        assertMatchesSchema(schemas.s_Error400, invalidResponse.body, name);
        expect(invalidResponse.body.code, name).toBe('VALIDATION_FAILED');
      }
    } finally {
      await cleanupFixture();
    }
  });
});
