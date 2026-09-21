import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const $fetch = vi.fn();
vi.stubGlobal('$fetch', $fetch);
vi.stubGlobal('useRuntimeConfig', () => ({
  backendInternalUrl: 'http://backend.internal',
  internalProxySecret: 'shh',
}));
vi.stubGlobal('createError', (input: { statusCode: number; statusMessage: string }) =>
  Object.assign(new Error(input.statusMessage), input),
);

vi.mock('~~/server/utils/internalBackend', () => ({
  internalBackendUrl: (_config: unknown, path: string) => `http://backend.internal${path}`,
  buildInternalBackendHeaders: (_config: unknown, headers: Record<string, string>) => headers,
}));

const { __testing, shirabeServiceToken } = await import('./shirabeService');

describe('shirabeServiceToken', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-22T00:00:00Z'));
    $fetch.mockReset();
    __testing.reset();
  });

  afterEach(() => vi.useRealTimers());

  it('coalesces lookup bursts and trusts the backend renewal deadline', async () => {
    $fetch.mockResolvedValue({ token: 'shared-bearer', expiresAt: Date.now() + 60_000, refreshAt: Date.now() + 30_000 });

    await expect(Promise.all([shirabeServiceToken(), shirabeServiceToken()])).resolves.toEqual([
      'shared-bearer',
      'shared-bearer',
    ]);
    expect($fetch).toHaveBeenCalledOnce();

    await expect(shirabeServiceToken()).resolves.toBe('shared-bearer');
    expect($fetch).toHaveBeenCalledOnce();

    vi.advanceTimersByTime(30_001);
    $fetch.mockResolvedValue({ token: 'renewed-bearer', expiresAt: Date.now() + 60_000, refreshAt: Date.now() + 30_000 });
    await expect(shirabeServiceToken()).resolves.toBe('renewed-bearer');
    expect($fetch).toHaveBeenCalledTimes(2);
  });

  it('does not cache an expired or malformed credential', async () => {
    $fetch.mockResolvedValue({ token: 'stale-bearer', expiresAt: Date.now(), refreshAt: Date.now() });

    await expect(shirabeServiceToken()).rejects.toMatchObject({ statusCode: 503 });
  });

  it('uses a still-valid bearer and backs off when backend renewal is unavailable', async () => {
    $fetch.mockResolvedValueOnce({ token: 'shared-bearer', expiresAt: Date.now() + 120_000, refreshAt: Date.now() + 30_000 });
    await expect(shirabeServiceToken()).resolves.toBe('shared-bearer');

    vi.advanceTimersByTime(30_001);
    $fetch.mockRejectedValue(new Error('backend unavailable'));
    await expect(shirabeServiceToken()).resolves.toBe('shared-bearer');
    await expect(shirabeServiceToken()).resolves.toBe('shared-bearer');
    expect($fetch).toHaveBeenCalledTimes(2);

    vi.advanceTimersByTime(90_001);
    await expect(shirabeServiceToken()).rejects.toThrow('backend unavailable');
  });
});
