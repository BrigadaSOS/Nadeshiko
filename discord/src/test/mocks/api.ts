import { mock } from 'bun:test';
import type { SearchResponse, SearchStatsResponse, ContextResponse, StatsResponse } from '../../api';

export const mockSearch = mock((): Promise<SearchResponse> => Promise.resolve({} as any));
export const mockFetchRandom = mock((): Promise<SearchResponse> => Promise.resolve({} as any));
export const mockGetSegmentContext = mock((): Promise<ContextResponse> => Promise.resolve({} as any));
export const mockGetSegmentByUuid = mock((): Promise<any> => Promise.resolve({} as any));
export const mockGetStats = mock((): Promise<StatsResponse> => Promise.resolve({} as any));
export const mockGetSearchStats = mock((): Promise<SearchStatsResponse> => Promise.resolve({} as any));
export const mockAutocompleteMedia = mock((): Promise<any> => Promise.resolve({} as any));
export const mockListMedia = mock((): Promise<any> => Promise.resolve({} as any));
export const mockDownloadFile = mock((): Promise<Buffer | null> => Promise.resolve(null));

export function resetApiMocks() {
  mockSearch.mockReset();
  mockFetchRandom.mockReset();
  mockGetSegmentContext.mockReset();
  mockGetSegmentByUuid.mockReset();
  mockGetStats.mockReset();
  mockGetSearchStats.mockReset();
  mockAutocompleteMedia.mockReset();
  mockListMedia.mockReset();
  mockDownloadFile.mockReset();
  mockDownloadFile.mockResolvedValue(null);
}

export function registerMocks() {
  mock.module('../../api', () => ({
    search: mockSearch,
    fetchRandom: mockFetchRandom,
    getSegmentContext: mockGetSegmentContext,
    getSegmentByUuid: mockGetSegmentByUuid,
    getStats: mockGetStats,
    getSearchStats: mockGetSearchStats,

    autocompleteMedia: mockAutocompleteMedia,
    listMedia: mockListMedia,
    downloadFile: mockDownloadFile,
    initSdk: () => {},
  }));

  mock.module('../../settings', () => ({
    initSettings: () => {},
    getGuildSettings: () => ({ language: 'both', autoEmbed: true }),
    setGuildSetting: () => {},
    resetGuildSettings: () => {},
  }));

  mock.module('../../mediaCache', () => ({
    searchMediaCache: async () => [],
    findMediaByPublicId: () => undefined,
  }));

  mock.module('../../config', () => ({
    BOT_CONFIG: {
      token: 'fake-token.fake.fake',
      apiBaseUrl: 'http://localhost:5000',
      apiKey: 'fake-key',
      frontendUrl: 'https://nadeshiko.co',
      embedColor: 0x8b5cf6,
      maxSearchResults: 20,
    },
    getApplicationId: () => 'fake-app-id',
  }));

  mock.module('../../instrumentation', () => ({
    traceCommand: async (_name: string, _interaction: unknown, fn: () => Promise<void>) => fn(),
    getActiveTraceId: () => undefined,
  }));

  mock.module('../../telemetry', () => ({
    initTelemetry: () => {},
    shutdownTelemetry: async () => {},
    getMeter: () => ({
      createHistogram: () => ({ record: () => {} }),
      createCounter: () => ({ add: () => {} }),
    }),
    getTracer: () => ({
      startActiveSpan: (_n: string, _o: unknown, fn: Function) =>
        fn({ setStatus: () => {}, recordException: () => {}, end: () => {} }),
    }),
  }));

  mock.module('../../logger', () => ({
    createLogger: () => ({
      info: () => {},
      debug: () => {},
      warn: () => {},
      error: () => {},
      child: () => ({ info: () => {}, debug: () => {}, warn: () => {}, error: () => {} }),
    }),
  }));
}
