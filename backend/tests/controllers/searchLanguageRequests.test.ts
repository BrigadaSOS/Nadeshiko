import express from 'express';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { estypes } from '@elastic/elasticsearch';
import { client } from '@config/elasticsearch';
import { Media } from '@app/models';
import { SegmentDocument } from '@app/services/search/SegmentDocument';
import { search, getSearchStats, searchWords } from '@app/controllers/searchController';
import { handleErrors } from '@app/middleware/errorHandler';
import { createSearchRouter } from 'generated/routes/search';
import * as schemas from 'generated/schemas';
import { Cache } from '@lib/cache';
import { getUnhandledReports } from '@app/services/reports/reportedContent';
import { assertMatchesSchema } from '../helpers/openapiContract';
import { request } from '../helpers/http';

vi.mock('@app/services/reports/reportedContent', () => ({
  getUnhandledReports: vi.fn(),
}));

const emptySearchResponse = {
  hits: { total: { value: 0, relation: 'eq' }, hits: [] },
} as unknown as estypes.SearchResponse;

const emptyStatsResponse = {
  responses: [
    { hits: { total: { value: 0, relation: 'eq' }, hits: [] }, aggregations: {} },
    { hits: { total: { value: 0, relation: 'eq' }, hits: [] }, aggregations: {} },
  ],
} as unknown as estypes.MsearchResponse;

const emptyWordsResponse = {
  responses: [{ hits: { total: { value: 0, relation: 'eq' }, hits: [] } }],
} as unknown as estypes.MsearchResponse;

const app = express();
app.use(express.json());
app.use(
  createSearchRouter({
    search,
    getSearchStats,
    searchWords,
    searchMedia: (() => undefined) as any,
  }),
);
app.use(handleErrors);

const esSearch = vi.spyOn(client as any, 'search');
const esMsearch = vi.spyOn(client as any, 'msearch');
const mediaInfo = vi.spyOn(Media, 'getMediaInfoMap');
const reports = vi.mocked(getUnhandledReports);

function searchRequest(): any {
  return esSearch.mock.calls.at(-1)?.[0];
}

function msearchRequest(): any {
  return esMsearch.mock.calls.at(-1)?.[0];
}

function exactTranslationFields(query: any): string[][] {
  const queries = query.bool.must[0].function_score.query.dis_max.queries;
  return queries.filter((clause: any) => clause.multi_match).map((clause: any) => clause.multi_match.fields);
}

function wordExactTranslationFields(body: any): string[][] {
  const queries = body.searches[1].query.bool.must[0].dis_max.queries;
  return queries.filter((clause: any) => clause.multi_match).map((clause: any) => clause.multi_match.fields);
}

async function postSearch(filters?: Record<string, unknown>) {
  return request(app)
    .post('/v1/search')
    .send({ query: { search: '猫', exactMatch: true }, ...(filters === undefined ? {} : { filters }) });
}

async function postStats(languages: unknown) {
  return request(app)
    .post('/v1/search/stats')
    .send({ query: { search: '猫', exactMatch: true }, filters: { languages } });
}

beforeEach(() => {
  esSearch.mockReset().mockResolvedValue(emptySearchResponse as any);
  esMsearch.mockReset().mockResolvedValue(emptyStatsResponse as any);
  mediaInfo.mockReset().mockResolvedValue({ results: new Map() } as any);
  reports.mockReset().mockResolvedValue({ segmentIds: new Set(), mediaWeights: new Map() });
  Cache.invalidate(SegmentDocument.SEARCH_STATS_CACHE);
});

afterAll(() => {
  esSearch.mockRestore();
  esMsearch.mockRestore();
  mediaInfo.mockRestore();
});

describe('search language HTTP characterization', () => {
  it.each([
    { name: 'canonical none', languages: [], fields: [], highlights: ['textJa'] },
    { name: 'canonical English', languages: ['EN'], fields: [['textEn.exact^1']], highlights: ['textJa', 'textEn'] },
    { name: 'canonical Spanish', languages: ['ES'], fields: [['textEs.exact^1']], highlights: ['textJa', 'textEs'] },
    {
      name: 'canonical both, with a duplicate',
      languages: ['EN', 'ES', 'EN'],
      fields: [['textEs.exact^1'], ['textEn.exact^1']],
      highlights: ['textJa', 'textEn', 'textEs'],
    },
    {
      name: 'legacy excludes Spanish, including accepted casing and duplicates',
      languages: { exclude: ['es', 'ES'] },
      fields: [['textEn.exact^1']],
      highlights: ['textJa', 'textEn'],
    },
    {
      name: 'legacy excludes English',
      languages: { exclude: ['EN'] },
      fields: [['textEs.exact^1']],
      highlights: ['textJa', 'textEs'],
    },
    {
      name: 'legacy exclusion of both',
      languages: { exclude: ['en', 'ES'] },
      fields: [],
      highlights: ['textJa'],
    },
    {
      name: 'legacy empty object means all translations',
      languages: {},
      fields: [['textEs.exact^1'], ['textEn.exact^1']],
      highlights: ['textJa', 'textEn', 'textEs'],
    },
    {
      name: 'canonical reordered languages mean all translations',
      languages: ['ES', 'EN'],
      fields: [['textEs.exact^1'], ['textEn.exact^1']],
      highlights: ['textJa', 'textEn', 'textEs'],
    },
    {
      name: 'omitted language filter means all translations',
      languages: undefined,
      fields: [['textEs.exact^1'], ['textEn.exact^1']],
      highlights: ['textJa', 'textEn', 'textEs'],
    },
  ])('$name emits only the requested language clauses', async ({ languages, fields, highlights }) => {
    const response = await postSearch(languages === undefined ? {} : { languages });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      segments: [],
      pagination: { hasMore: false, estimatedTotalHits: 0, estimatedTotalHitsRelation: 'EXACT', cursor: null },
    });
    assertMatchesSchema(schemas.s_SearchResponse, response.body, `POST /v1/search (${String(languages)})`);

    const body = searchRequest();
    expect(exactTranslationFields(body.query)).toEqual(fields);
    expect(Object.keys(body.highlight.fields)).toEqual(highlights);
  });

  it('rejects wire-invalid language casing, unknown legacy codes, and null before Elasticsearch', async () => {
    const lowerCanonical = await postSearch({ languages: ['en'] });
    const unknownLegacy = await postSearch({ languages: { exclude: ['fr'] } });
    const nullLanguage = await postSearch({ languages: null });

    expect(lowerCanonical.status).toBe(400);
    expect(lowerCanonical.body).toMatchObject({ code: 'VALIDATION_FAILED', status: 400 });
    expect(unknownLegacy.status).toBe(400);
    expect(unknownLegacy.body).toMatchObject({ code: 'VALIDATION_FAILED', status: 400 });
    expect(nullLanguage.status).toBe(400);
    expect(nullLanguage.body).toMatchObject({ code: 'VALIDATION_FAILED', status: 400 });
    assertMatchesSchema(schemas.s_Error400, lowerCanonical.body, 'invalid canonical language');
    assertMatchesSchema(schemas.s_Error400, unknownLegacy.body, 'invalid legacy language');
    assertMatchesSchema(schemas.s_Error400, nullLanguage.body, 'null language');
    expect(esSearch).not.toHaveBeenCalled();
  });

  it('falls back from strict to safe parsing without changing legacy language exclusion', async () => {
    const parseFailure = Object.assign(new Error('failed to parse query'), {
      meta: { body: { error: { type: 'parsing_exception', reason: 'failed to parse query' } } },
    });
    esSearch.mockRejectedValueOnce(parseFailure).mockResolvedValueOnce(emptySearchResponse as any);

    const response = await postSearch({ languages: { exclude: ['es'] } });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      segments: [],
      pagination: { hasMore: false, estimatedTotalHits: 0, estimatedTotalHitsRelation: 'EXACT', cursor: null },
    });
    assertMatchesSchema(schemas.s_SearchResponse, response.body, 'safe fallback search');
    expect(esSearch).toHaveBeenCalledTimes(2);

    const strictRequest = esSearch.mock.calls[0]![0] as any;
    const safeRequest = esSearch.mock.calls[1]![0] as any;
    expect(exactTranslationFields(strictRequest.query)).toEqual([['textEn.exact^1']]);
    expect(exactTranslationFields(safeRequest.query)).toEqual([['textEn.exact^1']]);
    expect(Object.keys(strictRequest.highlight.fields)).toEqual(['textJa', 'textEn']);
    expect(Object.keys(safeRequest.highlight.fields)).toEqual(['textJa', 'textEn']);
    expect(Object.keys(strictRequest.query.bool.must[0].function_score.query.dis_max.queries[0])).toEqual([
      'query_string',
    ]);
    expect(Object.keys(safeRequest.query.bool.must[0].function_score.query.dis_max.queries[0])).toEqual([
      'simple_query_string',
    ]);
  });
});

describe('search stats language cache characterization', () => {
  it('shares warm stats from legacy to equivalent canonical filters but misses for another language', async () => {
    const legacyEnglish = await postStats({ exclude: ['es'] });
    expect(legacyEnglish.status).toBe(200);
    expect(legacyEnglish.body).toEqual({ media: [], categories: [] });
    assertMatchesSchema(schemas.s_SearchStatsResponse, legacyEnglish.body, 'legacy stats');
    expect(esMsearch).toHaveBeenCalledTimes(1);
    expect(exactTranslationFields(msearchRequest().searches[1].query)).toEqual([['textEn.exact^1']]);

    const equivalentCanonical = await postStats(['EN']);
    expect(equivalentCanonical.status).toBe(200);
    expect(equivalentCanonical.body).toEqual({ media: [], categories: [] });
    expect(esMsearch).toHaveBeenCalledTimes(1);

    esMsearch.mockResolvedValue(emptyStatsResponse as any);
    const spanish = await postStats(['ES']);
    expect(spanish.status).toBe(200);
    expect(spanish.body).toEqual({ media: [], categories: [] });
    expect(esMsearch).toHaveBeenCalledTimes(2);
    expect(exactTranslationFields(msearchRequest().searches[1].query)).toEqual([['textEs.exact^1']]);
  });
});

describe('search words language characterization', () => {
  it('emits the real multi-search body and preserves the generated response contract', async () => {
    esMsearch.mockResolvedValue(emptyWordsResponse as any);

    const response = await request(app)
      .post('/v1/search/words')
      .send({ query: { words: ['猫'], exactMatch: true }, filters: { languages: { exclude: ['es'] } } });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      results: [{ word: '猫', isMatch: false, matchCount: 0, realMatchCount: 0, media: [] }],
    });
    assertMatchesSchema(schemas.s_SearchMultipleResponse, response.body, 'POST /v1/search/words');
    expect(msearchRequest().searches).toHaveLength(2);
    expect(wordExactTranslationFields(msearchRequest())).toEqual([['textEn.exact^1']]);
  });

  it('sends a canonical none-language word query without translation clauses', async () => {
    esMsearch.mockResolvedValue(emptyWordsResponse as any);

    const response = await request(app)
      .post('/v1/search/words')
      .send({ query: { words: ['猫'], exactMatch: true }, filters: { languages: [] }, include: ['media'] });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      results: [{ word: '猫', isMatch: false, matchCount: 0, realMatchCount: 0, media: [] }],
      includes: { media: {} },
    });
    expect(wordExactTranslationFields(msearchRequest())).toEqual([]);
  });
});
