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

const { readerHasOwnStack, readerStack, readerToken, reportStackFingerprint } = await import('./shirabeReader');
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

/**
 * The same session read, with the one field the lookup URL is cached under. A
 * linked reader's word cards live in their own browser for a day, so this value
 * is the only thing that can make yesterday's answer stop being served after
 * they switch a dictionary off in Shirabe.
 */
describe('readerStack', () => {
  beforeEach(() => {
    $fetch.mockReset();
    _resetForTests();
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
    _resetForTests();
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

/**
 * The bug that made the whole feature a no-op, and the reason it survived so
 * long: nothing threw and nothing logged.
 *
 * `defineCachedEventHandler` does not run the handler on the request it arrived
 * on. It builds a fresh event, copies `context` and drops the headers -- so
 * inside the handler there is no cookie to read, `readerToken` returns null at
 * its own guard, and every lookup quietly answers on the service key. A reader
 * who linked their account got the default dictionaries forever.
 */
describe('a handler that has lost its headers', () => {
  beforeEach(() => {
    $fetch.mockReset();
    _resetForTests();
  });

  /** What Nitro hands the handler: the same context object, no headers. */
  const stripped = (event: { context: Record<string, unknown> }) =>
    ({ context: event.context, node: { req: { headers: {} } }, headers: {} }) as never;

  it('still fetches the reader key when the cache layer has stripped the cookie', async () => {
    const event = fakeEvent(SIGNED_IN) as unknown as { context: Record<string, unknown> };
    $fetch.mockResolvedValue({ user: { shirabe: { linked: true, stackFingerprint: 'abc123' } } });

    // The cache decision runs on the real request, which is the last moment the
    // cookie exists.
    await readerStack(event as never);

    $fetch.mockResolvedValue({ token: 'shr_reader_key' });
    expect(await readerToken(stripped(event))).toBe('shr_reader_key');
  });

  // And the reader who never signed in must not acquire a cookie from anywhere:
  // an empty stash is still no session.
  it('answers null when there was no cookie to stash', async () => {
    const event = fakeEvent() as unknown as { context: Record<string, unknown> };

    await readerStack(event as never);

    expect(await readerToken(stripped(event))).toBeNull();
    expect($fetch).not.toHaveBeenCalled();
  });
});
