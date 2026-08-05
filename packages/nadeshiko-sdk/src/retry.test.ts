import { describe, test, expect, vi } from 'vitest';
import { withRetry } from './retry';

function makeResponse(status: number, headers: Record<string, string> = {}): Response {
  return new Response(null, { status, headers });
}

describe('withRetry', () => {
  describe('non-retryable status codes', () => {
    test.each([200, 201, 400, 401, 403, 404, 422])('returns %i immediately without retrying', async (status) => {
      const fetch = vi.fn(() => Promise.resolve(makeResponse(status)));
      const result = await withRetry(fetch, { initialDelayMs: 0 })('https://example.com');
      expect(result.status).toBe(status);
      expect(fetch).toHaveBeenCalledTimes(1);
    });
  });

  describe('retryable status codes', () => {
    test.each([408, 429, 500, 502, 503, 504])('retries on %i', async (status) => {
      const fetch = vi.fn()
        .mockResolvedValueOnce(makeResponse(status))
        .mockResolvedValueOnce(makeResponse(status))
        .mockResolvedValue(makeResponse(200));

      const result = await withRetry(fetch, { initialDelayMs: 0 })('https://example.com');
      expect(result.status).toBe(200);
      expect(fetch).toHaveBeenCalledTimes(3);
    });
  });

  describe('maxRetries', () => {
    test('stops after maxRetries attempts and returns the last error response', async () => {
      const fetch = vi.fn(() => Promise.resolve(makeResponse(500)));
      const result = await withRetry(fetch, { maxRetries: 1, initialDelayMs: 0 })('https://example.com');
      expect(result.status).toBe(500);
      expect(fetch).toHaveBeenCalledTimes(2); // 1 initial + 1 retry
    });

    test('maxRetries: 0 means no retries', async () => {
      const fetch = vi.fn(() => Promise.resolve(makeResponse(503)));
      const result = await withRetry(fetch, { maxRetries: 0, initialDelayMs: 0 })('https://example.com');
      expect(result.status).toBe(503);
      expect(fetch).toHaveBeenCalledTimes(1);
    });

    test('default maxRetries is 2', async () => {
      const fetch = vi.fn(() => Promise.resolve(makeResponse(500)));
      await withRetry(fetch, { initialDelayMs: 0 })('https://example.com');
      expect(fetch).toHaveBeenCalledTimes(3); // 1 initial + 2 retries
    });
  });

  describe('network errors', () => {
    test('retries on network error and succeeds', async () => {
      const fetch = vi.fn()
        .mockRejectedValueOnce(new TypeError('fetch failed'))
        .mockResolvedValue(makeResponse(200));

      const result = await withRetry(fetch, { initialDelayMs: 0 })('https://example.com');
      expect(result.status).toBe(200);
      expect(fetch).toHaveBeenCalledTimes(2);
    });

    test('throws after exhausting retries on repeated network errors', async () => {
      const error = new TypeError('fetch failed');
      const fetch = vi.fn(() => Promise.reject(error));

      await expect(
        withRetry(fetch, { maxRetries: 2, initialDelayMs: 0 })('https://example.com'),
      ).rejects.toThrow('fetch failed');
      expect(fetch).toHaveBeenCalledTimes(3);
    });
  });

  describe('Retry-After header', () => {
    test('respects numeric Retry-After (seconds)', async () => {
      const delays: number[] = [];
      const realSleep = globalThis.setTimeout;
      let sleepSpy = vi.fn((fn: () => void, ms: number) => {
        delays.push(ms);
        return realSleep(fn, 0);
      });
      globalThis.setTimeout = sleepSpy as any;

      const fetch = vi.fn()
        .mockResolvedValueOnce(makeResponse(429, { 'Retry-After': '2' }))
        .mockResolvedValue(makeResponse(200));

      try {
        await withRetry(fetch, { maxRetries: 1, initialDelayMs: 500 })('https://example.com');
      } finally {
        globalThis.setTimeout = realSleep;
      }

      // The Retry-After: 2 should translate to 2000ms delay
      expect(delays.some(d => d === 2000)).toBe(true);
    });
  });

  describe('passes init through', () => {
    test('forwards headers to fetch', async () => {
      const fetch = vi.fn((_input: RequestInfo | URL, _init?: RequestInit) => Promise.resolve(makeResponse(200)));
      await withRetry(fetch, { initialDelayMs: 0 })('https://example.com', {
        headers: { Authorization: 'Bearer token' },
      });
      expect(fetch.mock.calls[0][1]).toMatchObject({ headers: { Authorization: 'Bearer token' } });
    });
  });

  describe('existing signal is respected', () => {
    test('does not override caller-provided signal even when timeout is set', async () => {
      const controller = new AbortController();
      const fetch = vi.fn((_input: RequestInfo | URL, _init?: RequestInit) => Promise.resolve(makeResponse(200)));

      await withRetry(fetch, { timeout: 5000 })('https://example.com', {
        signal: controller.signal,
      });

      // When caller provides a signal, timeout path is skipped — init is passed as-is
      expect(fetch.mock.calls[0][1]?.signal).toBe(controller.signal);
    });
  });
});
