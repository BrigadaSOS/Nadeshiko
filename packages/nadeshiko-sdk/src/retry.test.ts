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

    test('does NOT retry 429 — a rate limit is an instruction to stop', async () => {
      // Regression test for the 2026-08-09 outage. 429 was in the retryable
      // set, so each throttled server-side render fired three requests at a
      // bucket that was already full: ~2k visitor requests became 31,422
      // internal ones. Retrying the one status that means "you are sending too
      // much" is the single response guaranteed to deepen the hole.
      const fetch = vi.fn(() => Promise.resolve(makeResponse(429, { 'Retry-After': '60' })));
      const result = await withRetry(fetch, { initialDelayMs: 0 })('https://example.com');
      expect(result.status).toBe(429);
      expect(fetch).toHaveBeenCalledTimes(1);
    });
  });

  describe('retryable status codes', () => {
    test.each([408, 500, 502, 503, 504])('retries on %i', async (status) => {
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
        .mockResolvedValueOnce(makeResponse(503, { 'Retry-After': '2' }))
        .mockResolvedValue(makeResponse(200));

      try {
        await withRetry(fetch, { maxRetries: 1, initialDelayMs: 500 })('https://example.com');
      } finally {
        globalThis.setTimeout = realSleep;
      }

      // The Retry-After: 2 should translate to 2000ms delay
      expect(delays.some(d => d === 2000)).toBe(true);
    });

    test('clamps Retry-After to maxDelayMs', async () => {
      // Retry-After is a value the *server* picks, so unclamped it lets the
      // server decide how long this client is unavailable. Nadeshiko's backend
      // sends the whole remaining window (up to 60s), which is long enough to
      // hold a server-side render — and the worker running it — hostage.
      // maxDelayMs is the caller stating a ceiling; a header does not outrank it.
      const delays: number[] = [];
      const realSleep = globalThis.setTimeout;
      globalThis.setTimeout = vi.fn((fn: () => void, ms: number) => {
        delays.push(ms);
        return realSleep(fn, 0);
      }) as any;

      const fetch = vi.fn()
        .mockResolvedValueOnce(makeResponse(503, { 'Retry-After': '600' }))
        .mockResolvedValue(makeResponse(200));

      try {
        await withRetry(fetch, { maxRetries: 1, initialDelayMs: 10, maxDelayMs: 1_000 })(
          'https://example.com',
        );
      } finally {
        globalThis.setTimeout = realSleep;
      }

      expect(delays.every(d => d <= 1_000)).toBe(true);
      expect(delays).not.toContain(600_000);
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

describe('a Request body survives a retry', () => {
  /**
   * Nadeshiko: ~70 reports from 16 readers in the week to 2026-08-26, filed as
   * three separate error-tracking issues because Chrome and Firefox word it
   * differently ("Cannot construct a Request with a Request object that has
   * already been used" / "Body has already been consumed"). One bug: the retry
   * handed the same consumed `Request` to the second attempt.
   *
   * These use a real `fetch`-like boundary that READS the body, because that is
   * what consumes the stream -- a `vi.fn()` that ignores its argument cannot
   * fail the way production did.
   */
  test('a retried POST sends its body again, instead of throwing', async () => {
    const seen: string[] = [];
    const fetch = vi.fn(async (input: RequestInfo | URL) => {
      seen.push(await (input as Request).text());
      return makeResponse(seen.length < 3 ? 503 : 200);
    });

    const request = new Request('https://example.com', { method: 'POST', body: '{"q":"ねこ"}' });
    const result = await withRetry(fetch, { initialDelayMs: 0 })(request);

    expect(result.status).toBe(200);
    expect(seen).toEqual(['{"q":"ねこ"}', '{"q":"ねこ"}', '{"q":"ねこ"}']);
  });

  test("leaves the caller's own Request unread, so they can still use it", async () => {
    const fetch = vi.fn(async (input: RequestInfo | URL) => {
      await (input as Request).text();
      return makeResponse(200);
    });

    const request = new Request('https://example.com', { method: 'POST', body: 'payload' });
    await withRetry(fetch, { initialDelayMs: 0 })(request);

    expect(request.bodyUsed).toBe(false);
    await expect(request.text()).resolves.toBe('payload');
  });

  test('passes a plain URL through untouched', async () => {
    let seen: RequestInfo | URL | undefined;
    const fetch = vi.fn(async (input: RequestInfo | URL) => {
      seen = input;
      return makeResponse(200);
    });

    await withRetry(fetch, { initialDelayMs: 0 })('https://example.com/v1/search');

    expect(seen).toBe('https://example.com/v1/search');
  });
});
