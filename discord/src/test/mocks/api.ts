import { vi } from 'vitest';
import type { SearchResponse, SearchStatsResponse, ContextResponse, StatsResponse } from '../../api';

export const mockSearch = vi.fn((): Promise<SearchResponse> => Promise.resolve({} as any));
export const mockFetchRandom = vi.fn((): Promise<SearchResponse> => Promise.resolve({} as any));
export const mockGetSegmentContext = vi.fn((): Promise<ContextResponse> => Promise.resolve({} as any));
export const mockGetSegmentByUuid = vi.fn((): Promise<any> => Promise.resolve({} as any));
export const mockGetStats = vi.fn((): Promise<StatsResponse> => Promise.resolve({} as any));
export const mockGetSearchStats = vi.fn((): Promise<SearchStatsResponse> => Promise.resolve({} as any));
export const mockAutocompleteMedia = vi.fn((): Promise<any> => Promise.resolve({} as any));
export const mockListMedia = vi.fn((): Promise<any> => Promise.resolve({} as any));
export const mockDownloadFile = vi.fn((): Promise<Buffer | null> => Promise.resolve(null));

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

// Registration happens as this module is evaluated, which is why test files have
// to import it before the command handlers they exercise.
// The real module is spread back in so that pure helpers such as `parseCategory`
// keep working; only the network-facing calls are replaced.
type MockSpan = {
  setStatus: () => void;
  recordException: () => void;
  end: () => void;
};

vi.mock('../../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api')>()),
  search: mockSearch,
  fetchRandom: mockFetchRandom,
  getSegmentContext: mockGetSegmentContext,
  getSegment: mockGetSegmentByUuid,
  getStats: mockGetStats,
  getSearchStats: mockGetSearchStats,

  searchMedia: mockAutocompleteMedia,
  listMedia: mockListMedia,
  downloadFile: mockDownloadFile,
  initSdk: () => {},
}));

vi.mock('../../settings', () => ({
  initSettings: () => {},
  getGuildSettings: () => ({ language: 'both' }),
  setGuildSetting: () => {},
  resetGuildSettings: () => {},
}));

vi.mock('../../mediaCache', () => ({
  searchMediaCache: async () => [],
  findMediaByPublicId: () => undefined,
}));

vi.mock('../../config', () => ({
  BOT_CONFIG: {
    token: 'fake-token.fake.fake',
    apiBaseUrl: 'http://localhost:5000',
    apiKey: 'fake-key',
    frontendUrl: 'https://nadeshiko.co',
    embedColor: 0x8b5cf6,
    maxSearchResults: 20,
  },
  getApplicationId: () => 'fake-app-id',
  validateConfig: () => {},
}));

// traceComponent and traceModal are pass-throughs rather than no-ops: the flow
// tests drive real button presses through the collector handlers these now
// wrap, so a mock that dropped the handler would silently test nothing.
vi.mock('../../instrumentation', () => ({
  traceCommand: async (_name: string, _interaction: unknown, fn: () => Promise<void>) => fn(),
  traceOperation: async (_kind: string, _name: string, _actor: unknown, fn: () => Promise<void>) => fn(),
  traceComponent: (_surface: string, handler: (i: unknown) => Promise<void>) => handler,
  traceModal: (_surface: string, handler: (i: unknown) => Promise<void>) => handler,
  getActiveTraceId: () => undefined,
}));

vi.mock('../../telemetry', () => ({
  initTelemetry: () => {},
  shutdownTelemetry: async () => {},
  getMeter: () => ({
    createHistogram: () => ({ record: () => {} }),
    createCounter: () => ({ add: () => {} }),
    createObservableGauge: () => ({ addCallback: () => {} }),
  }),
  getTracer: () => ({
    startActiveSpan: (_n: string, _o: unknown, fn: (span: MockSpan) => unknown) =>
      fn({ setStatus: () => {}, recordException: () => {}, end: () => {} }),
  }),
}));

vi.mock('../../logger', () => ({
  createLogger: () => ({
    info: () => {},
    debug: () => {},
    warn: () => {},
    error: () => {},
    child: () => ({ info: () => {}, debug: () => {}, warn: () => {}, error: () => {} }),
  }),
}));
