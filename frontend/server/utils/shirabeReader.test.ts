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

const { readerStack, readerToken, reportStackFingerprint } = await import('./shirabeReader');
const { _resetSsrAuthCacheForTests } = await import('./ssrAuthCache');

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
describe('readerStack cache selection', () => {
  beforeEach(() => {
    $fetch.mockReset();
    _resetSsrAuthCacheForTests();
  });

  // Most of the traffic: every crawler, every share link, every signed-out
  // reader. It must not cost a round trip to establish something the missing
  // cookie already settled.
  it('answers for a reader with no session without asking anybody', async () => {
    expect((await readerStack(fakeEvent())).linked).toBe(false);
    expect($fetch).not.toHaveBeenCalled();
  });

  it('reads the link off the session', async () => {
    $fetch.mockResolvedValue({ user: { shirabe: { linked: true } } });

    expect((await readerStack(fakeEvent(SIGNED_IN))).linked).toBe(true);
    // Never slides the session: a lookup answer can be stored in the shared
    // cache, so the renewed cookie that a refresh returns could not be passed
    // on from here even if it arrived. `identity-auth` is the path that can.
    expect($fetch).toHaveBeenCalledWith(expect.stringContaining('disableRefresh=true'), expect.anything());
  });

  it('treats a signed-in reader who linked nothing as having no stack', async () => {
    $fetch.mockResolvedValue({ user: { id: 1 } });

    expect((await readerStack(fakeEvent(SIGNED_IN))).linked).toBe(false);
  });

  // The backend being unreachable is not a reason to fail a word card. The
  // default dictionaries are a worse answer than the reader's own and a far
  // better one than an error.
  it('falls back to the default dictionaries when the session cannot be read', async () => {
    $fetch.mockRejectedValue(new Error('backend is down'));

    expect((await readerStack(fakeEvent(SIGNED_IN))).linked).toBe(false);
  });

  // The cache decision and the handler both ask. Two session reads per lookup
  // would undo the point of resolving it from something already cached.
  it('resolves once per request', async () => {
    $fetch.mockResolvedValue({ user: { shirabe: { linked: true } } });
    const event = fakeEvent(SIGNED_IN);

    await readerStack(event);
    await readerStack(event);

    expect($fetch).toHaveBeenCalledTimes(1);
  });
});

/**
 * The same session read, with the one field the lookup URL is cached under. A
 * linked reader's word cards live in their own browser for a day, so this value
 * is the only thing that can make yesterday's answer stop being served after
 * they switch a dictionary off in Shirabe.
 */
describe('readerStack', () => {
  beforeEach(() => {
    $fetch.mockReset();
    _resetSsrAuthCacheForTests();
  });

  it('carries the fingerprint the session reports', async () => {
    $fetch.mockResolvedValue({ user: { shirabe: { linked: true, stackFingerprint: 'abc123' } } });

    expect(await readerStack(fakeEvent(SIGNED_IN))).toEqual({ linked: true, fingerprint: 'abc123' });
  });

  // A link made before the backend started copying fingerprints, or one whose
  // refresh has never succeeded. It is still a linked reader -- the lookup must
  // still be made with their key -- and their URL simply carries no stack.
  it('is still a linked reader when the fingerprint is missing', async () => {
    $fetch.mockResolvedValue({ user: { shirabe: { linked: true } } });

    expect(await readerStack(fakeEvent(SIGNED_IN))).toEqual({ linked: true, fingerprint: null });
  });

  it('names no stack for a reader who linked nothing', async () => {
    $fetch.mockResolvedValue({ user: { id: 1 } });

    expect(await readerStack(fakeEvent(SIGNED_IN))).toEqual({ linked: false, fingerprint: null });
  });
});

/**
 * Handing a drifted fingerprint back to the backend. It rides on a request that
 * has already answered, so the only behaviour that matters is that it cannot
 * take the lookup down with it.
 */
describe('reportStackFingerprint', () => {
  beforeEach(() => {
    $fetch.mockReset();
    _resetSsrAuthCacheForTests();
  });

  it('posts the fingerprint to the backend', async () => {
    $fetch.mockResolvedValue({});

    await reportStackFingerprint(fakeEvent(SIGNED_IN), 'abc123');

    expect($fetch).toHaveBeenCalledWith(
      'http://backend.internal/v1/user/connections/shirabe/resync',
      expect.objectContaining({ method: 'POST', body: { stackFingerprint: 'abc123' } }),
    );
  });

  it('never throws, because the lookup it rides on has already answered', async () => {
    $fetch.mockRejectedValue(new Error('backend is down'));

    await expect(reportStackFingerprint(fakeEvent(SIGNED_IN), 'abc123')).resolves.toBeUndefined();
  });
});

describe('readerToken', () => {
  beforeEach(() => {
    $fetch.mockReset();
    _resetSsrAuthCacheForTests();
  });

  it('fetches nothing for a reader with no session', async () => {
    expect(await readerToken(fakeEvent())).toBeNull();
    expect($fetch).not.toHaveBeenCalled();
  });

  it('returns the key the backend hands over', async () => {
    $fetch.mockResolvedValue({ token: 'shra_reader_access' });

    expect(await readerToken(fakeEvent(SIGNED_IN))).toBe('shra_reader_access');
  });

  // Every way this can fail -- an unlinked reader (404), a revoked key, a
  // backend blip -- means the same thing here: ask as ourselves instead.
  it('answers null rather than throwing when there is no credential', async () => {
    $fetch.mockRejectedValue(Object.assign(new Error('not found'), { statusCode: 404 }));

    expect(await readerToken(fakeEvent(SIGNED_IN))).toBeNull();
  });
});
