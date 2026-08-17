import { describe, it, expect, vi, beforeEach } from 'vitest';

const $fetch = vi.fn();
vi.stubGlobal('$fetch', $fetch);
vi.stubGlobal('useRuntimeConfig', () => ({
  backendInternalUrl: 'http://backend.internal',
  internalProxySecret: 'shh',
}));

vi.mock('~~/server/utils/logger', () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock('~~/server/utils/internalBackend', () => ({
  internalBackendUrl: (_config: unknown, path: string) => `http://backend.internal${path}`,
  buildInternalBackendHeaders: (_config: unknown, headers: Record<string, string>) => headers,
}));

const { readerHasOwnStack, readerToken } = await import('./shirabeReader');
const { _resetForTests } = await import('./ssrAuthCache');

function fakeEvent(cookieHeader?: string) {
  return {
    context: {} as Record<string, unknown>,
    node: { req: { socket: { remoteAddress: '1.2.3.4' }, headers: { cookie: cookieHeader } } },
    headers: { cookie: cookieHeader },
  } as never;
}

const SIGNED_IN = 'nadeshiko.session_token=tok1';

/**
 * Whether a lookup may be answered from the shared cache. This decides whether a
 * response is stored where other readers are served from, so the tests that
 * matter most are the ones about where the answer comes from and what happens
 * when it cannot be found.
 */
describe('readerHasOwnStack', () => {
  beforeEach(() => {
    $fetch.mockReset();
    _resetForTests();
  });

  // Most of the traffic: every crawler, every share link, every signed-out
  // reader. It must not cost a round trip to establish something the missing
  // cookie already settled.
  it('answers for a reader with no session without asking anybody', async () => {
    expect(await readerHasOwnStack(fakeEvent())).toBe(false);
    expect($fetch).not.toHaveBeenCalled();
  });

  it('reads the link off the session', async () => {
    $fetch.mockResolvedValue({ user: { shirabe: { linked: true } } });

    expect(await readerHasOwnStack(fakeEvent(SIGNED_IN))).toBe(true);
  });

  it('treats a signed-in reader who linked nothing as having no stack', async () => {
    $fetch.mockResolvedValue({ user: { id: 1 } });

    expect(await readerHasOwnStack(fakeEvent(SIGNED_IN))).toBe(false);
  });

  // The backend being unreachable is not a reason to fail a word card. The
  // default dictionaries are a worse answer than the reader's own and a far
  // better one than an error.
  it('falls back to the default dictionaries when the session cannot be read', async () => {
    $fetch.mockRejectedValue(new Error('backend is down'));

    expect(await readerHasOwnStack(fakeEvent(SIGNED_IN))).toBe(false);
  });

  // The cache decision and the handler both ask. Two session reads per lookup
  // would undo the point of resolving it from something already cached.
  it('resolves once per request', async () => {
    $fetch.mockResolvedValue({ user: { shirabe: { linked: true } } });
    const event = fakeEvent(SIGNED_IN);

    await readerHasOwnStack(event);
    await readerHasOwnStack(event);

    expect($fetch).toHaveBeenCalledTimes(1);
  });
});

describe('readerToken', () => {
  beforeEach(() => {
    $fetch.mockReset();
    _resetForTests();
  });

  it('fetches nothing for a reader with no session', async () => {
    expect(await readerToken(fakeEvent())).toBeNull();
    expect($fetch).not.toHaveBeenCalled();
  });

  it('returns the key the backend hands over', async () => {
    $fetch.mockResolvedValue({ token: 'shr_reader_key' });

    expect(await readerToken(fakeEvent(SIGNED_IN))).toBe('shr_reader_key');
  });

  // Every way this can fail -- an unlinked reader (404), a revoked key, a
  // backend blip -- means the same thing here: ask as ourselves instead.
  it('answers null rather than throwing when there is no credential', async () => {
    $fetch.mockRejectedValue(Object.assign(new Error('not found'), { statusCode: 404 }));

    expect(await readerToken(fakeEvent(SIGNED_IN))).toBeNull();
  });
});
