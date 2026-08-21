import { createHash } from 'node:crypto';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { encryptSecret } from '@lib/secretBox';

const CONFIG = {
  SHIRABE_API_BASE: 'https://shirabe.test',
  SHIRABE_OAUTH_CLIENT_ID: 'nadeshiko',
  SHIRABE_OAUTH_CLIENT_SECRET: 'a-test-client-secret',
  SHIRABE_OAUTH_REDIRECT_URI: 'https://nadeshiko.co/link/shirabe/callback',
  SHIRABE_CONNECTION_SECRET: 'a-test-connection-secret',
};

vi.mock('@config/config', () => ({ config: CONFIG }));
vi.mock('@config/log', () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() } }));

const saved: Record<string, unknown>[] = [];

/**
 * Column-scoped writes, as `{criteria, patch}`.
 *
 * Worth recording separately from `saved` because WHICH columns a write names
 * is the property under test: everything but the two token writers has to leave
 * the pair alone, or it writes a superseded copy back over a renewal it never
 * saw. See `never writes the token pair back` below.
 */
const updates: { criteria: Record<string, unknown>; patch: Record<string, unknown> }[] = [];

// The row `renewAccessToken` locks and re-reads inside its transaction. Tests
// that exercise renewal set this to the connection the lock should return.
let lockedConnection: Record<string, unknown> | null = null;

vi.mock('@app/models/ShirabeConnection', () => {
  const manager = {
    transaction: (cb: (m: unknown) => unknown) => Promise.resolve(cb(manager)),
    createQueryBuilder: () => ({
      setLock: () => ({
        where: () => ({
          getOne: () => Promise.resolve(lockedConnection),
        }),
      }),
    }),
    save: (connection: Record<string, unknown>) => {
      saved.push(connection);
      return Promise.resolve(connection);
    },
  };
  return {
    ShirabeConnection: {
      findOne: vi.fn(async () => null),
      update: vi.fn(async (criteria: Record<string, unknown>, patch: Record<string, unknown>) => {
        updates.push({ criteria, patch });
        return { affected: 1 };
      }),
      create: vi.fn((attributes: Record<string, unknown>) => ({
        ...attributes,
        save() {
          saved.push(this as Record<string, unknown>);
          return Promise.resolve(this);
        },
      })),
      getRepository: () => ({ manager }),
    },
  };
});

const {
  startLink,
  completeLink,
  missingScopes,
  readAccessToken,
  refreshStack,
  reencryptTokens,
  resyncStack,
  refreshIfStale,
  getReaderAccessToken,
  stackIsStale,
  unlink,
  REQUIRED_SCOPES,
  STACK_STALE_MS,
} = await import('@app/services/shirabe/connection');

/** The reader every stored row here belongs to. Each ciphertext is bound to it,
 *  so a fixture sealed for anyone else would fail to open -- which is the
 *  property being relied on rather than a detail of the fixture. */
const STORED_USER_ID = 42;
const accessContext = (userId = STORED_USER_ID) => ({ purpose: 'shirabe.access-token', aad: String(userId) });
const refreshContext = (userId = STORED_USER_ID) => ({ purpose: 'shirabe.refresh-token', aad: String(userId) });

function sealAccess(value: string, userId = STORED_USER_ID) {
  return encryptSecret(value, CONFIG.SHIRABE_CONNECTION_SECRET, accessContext(userId));
}
function sealRefresh(value: string, userId = STORED_USER_ID) {
  return encryptSecret(value, CONFIG.SHIRABE_CONNECTION_SECRET, refreshContext(userId));
}

/** A stored link, in the shape the service reads and writes it. `accessTokenExpiresAt`
 *  is an hour out by default, so a fixture is "not due" unless a test says so. */
function storedConnection(overrides: Record<string, unknown> = {}) {
  const userId = (overrides.userId as number) ?? STORED_USER_ID;
  return {
    userId,
    accessTokenCiphertext: sealAccess('shra_reader_access', userId),
    refreshTokenCiphertext: sealRefresh('shrr_reader_refresh', userId),
    accessTokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
    stack: ['jmdict:en'],
    stackFingerprint: 'abc123',
    syncedAt: new Date('2026-01-01T00:00:00Z'),
    scopes: [...REQUIRED_SCOPES],
    /** Null is a live link, which is what almost every fixture here wants. */
    disconnectedAt: null as Date | null,
    save() {
      saved.push(this as Record<string, unknown>);
      return Promise.resolve(this);
    },
    ...overrides,
  };
}

/** Shirabe answering the calls a link makes: the token exchange, /me, the
 *  renewal, and the revoke a relink or unlink fires. `granted` shapes the
 *  scopes both the token response and /me report. */
function mockShirabe(granted: string[] = ['READ_DICTIONARY', 'READ_ACCOUNT']) {
  const fetchMock = vi.fn(async (url: URL | string, init?: ShirabeRequest) => {
    const target = String(url);
    if (target.includes('/oauth/token')) {
      const body = JSON.parse(init?.body ?? '{}') as { grant_type?: string };
      return Response.json({
        access_token: body.grant_type === 'refresh_token' ? 'shra_renewed_access' : 'shra_the_access',
        refresh_token: body.grant_type === 'refresh_token' ? 'shrr_renewed_refresh' : 'shrr_the_refresh',
        expires_in: 3600,
        scope: granted.join(' '),
      });
    }
    if (target.includes('/oauth/revoke')) return new Response(null, { status: 200 });
    return Response.json({
      user: { name: 'lumi', displayName: 'Lumi' },
      credential: { scopes: granted },
      preferences: {
        dictionaries: ['sanseido:ja', 'jmdict:en'],
        stackFingerprint: '9f2c1b7d4a0e6835',
        stackIsPrivate: false,
      },
    });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

type ShirabeRequest = { method: string; body: string; headers: Record<string, string> };

describe('shirabe connection', () => {
  beforeEach(() => {
    saved.length = 0;
    updates.length = 0;
    lockedConnection = null;
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('startLink', () => {
    it('sends the reader to Shirabe with everything the flow needs', () => {
      const { authorizeUrl } = startLink(42);
      const url = new URL(authorizeUrl);

      expect(url.origin + url.pathname).toBe('https://shirabe.test/oauth/authorize');
      expect(url.searchParams.get('response_type')).toBe('code');
      expect(url.searchParams.get('client_id')).toBe('nadeshiko');
      expect(url.searchParams.get('redirect_uri')).toBe(CONFIG.SHIRABE_OAUTH_REDIRECT_URI);
      expect(url.searchParams.get('code_challenge_method')).toBe('S256');
      expect(url.searchParams.get('code_challenge')).toBeTruthy();
    });

    it('asks for exactly the two scopes a dictionary stack needs', () => {
      const { authorizeUrl } = startLink(42);
      expect(new URL(authorizeUrl).searchParams.get('scope')).toBe('READ_DICTIONARY READ_ACCOUNT');
    });

    it('seals a different state every time', () => {
      expect(startLink(42).state).not.toBe(startLink(42).state);
    });
  });

  describe('missingScopes', () => {
    it('is empty for a link carrying everything required', () => {
      expect(missingScopes({ scopes: [...REQUIRED_SCOPES] } as never)).toEqual([]);
    });
    it('names what a link granted before a scope was added does not carry', () => {
      expect(missingScopes({ scopes: [] } as never)).toEqual([...REQUIRED_SCOPES]);
    });
    it('ignores scopes granted beyond what is required', () => {
      expect(missingScopes({ scopes: [...REQUIRED_SCOPES, 'WRITE_SRS'] } as never)).toEqual([]);
    });
  });

  describe('completeLink', () => {
    it('proves the redemption with the verifier the challenge was built from', async () => {
      const { authorizeUrl, state } = startLink(42);
      const challenge = new URL(authorizeUrl).searchParams.get('code_challenge');
      const fetchMock = mockShirabe();

      await completeLink(42, 'the-code', state);

      const body = JSON.parse(fetchMock.mock.calls[0]?.[1]?.body ?? '{}');
      expect(body.code).toBe('the-code');
      expect(createHash('sha256').update(body.code_verifier).digest('base64url')).toBe(challenge);
      // A confidential client proves itself on the exchange.
      expect(body.client_secret).toBe(CONFIG.SHIRABE_OAUTH_CLIENT_SECRET);
    });

    it('stores both tokens encrypted, never in the clear', async () => {
      const { state } = startLink(42);
      mockShirabe();

      await completeLink(42, 'the-code', state);

      const [connection] = saved;
      expect(String(connection.accessTokenCiphertext)).not.toContain('shra_the_access');
      expect(String(connection.refreshTokenCiphertext)).not.toContain('shrr_the_refresh');
      expect(String(connection.accessTokenCiphertext)).toMatch(/^v2\.[0-9a-f]{8}\./);
      // And an expiry it can renew ahead of.
      expect((connection.accessTokenExpiresAt as Date).getTime()).toBeGreaterThan(Date.now());
    });

    it('copies the stack the lookups will be cached by', async () => {
      const { state } = startLink(42);
      mockShirabe();

      await completeLink(42, 'the-code', state);

      const [connection] = saved;
      expect(connection.stack).toEqual(['sanseido:ja', 'jmdict:en']);
      expect(connection.stackFingerprint).toBe('9f2c1b7d4a0e6835');
      expect(connection.shirabeName).toBe('Lumi');
    });

    it('refuses a state that belongs to a different account', async () => {
      const { state } = startLink(999);
      await expect(completeLink(42, 'the-code', state)).rejects.toThrow(/different account/);
      expect(saved).toHaveLength(0);
    });

    it('refuses a state we did not seal', async () => {
      await expect(completeLink(42, 'the-code', 'not-a-real-state')).rejects.toThrow(/not valid/);
    });

    it('refuses a state that has expired', async () => {
      const { state } = startLink(42);
      vi.useFakeTimers();
      vi.setSystemTime(Date.now() + 16 * 60 * 1000);
      await expect(completeLink(42, 'the-code', state)).rejects.toThrow(/expired/);
    });

    it('stores nothing when Shirabe rejects the code', async () => {
      const { state } = startLink(42);
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => new Response('{"error":"invalid_grant"}', { status: 400 })),
      );
      await expect(completeLink(42, 'the-code', state)).rejects.toThrow(/would not complete/);
      expect(saved).toHaveLength(0);
    });

    it('refuses a grant that came back missing a required scope', async () => {
      const { state } = startLink(42);
      const fetchMock = mockShirabe(['READ_DICTIONARY']);

      await expect(completeLink(42, 'the-code', state)).rejects.toThrow(/could not grant everything/);
      expect(saved).toHaveLength(0);
      // Named from the token response's `scope` alone, before /me is read: a
      // token without READ_ACCOUNT cannot read /me, so asking first would erase
      // the one misconfiguration this exists to name.
      expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/api/v1/me'))).toBe(false);
    });

    // From the exchange on, a grant exists on the reader's Shirabe access list.
    // Every way the link can then fail to be stored has to hand it back.
    it('revokes the grant it just got when the link cannot be completed', async () => {
      const { state } = startLink(42);
      const fetchMock = mockShirabe(['READ_DICTIONARY']);

      await expect(completeLink(42, 'the-code', state)).rejects.toThrow();

      const revoke = fetchMock.mock.calls.find(([url]) => String(url).includes('/oauth/revoke'));
      expect(revoke, 'the new grant is handed back to Shirabe').toBeTruthy();
      expect(JSON.parse(revoke?.[1]?.body ?? '{}').token).toBe('shrr_the_refresh');
    });

    it('revokes the grant it just got when storing the link fails', async () => {
      const { ShirabeConnection } = await import('@app/models/ShirabeConnection');
      vi.mocked(ShirabeConnection.create).mockReturnValueOnce({
        userId: 42,
        save: () => Promise.reject(new Error('the database is away')),
      } as never);
      const { state } = startLink(42);
      const fetchMock = mockShirabe();

      await expect(completeLink(42, 'the-code', state)).rejects.toThrow('the database is away');

      const revoke = fetchMock.mock.calls.find(([url]) => String(url).includes('/oauth/revoke'));
      expect(JSON.parse(revoke?.[1]?.body ?? '{}').token).toBe('shrr_the_refresh');
    });

    // Re-consent is how a scope upgrade happens, and it goes through this path
    // every time: Shirabe issues a NEW grant, so without this the reader
    // collects a live orphaned grant on their access list per upgrade.
    it('revokes the grant it is replacing when a link is redone', async () => {
      const { ShirabeConnection } = await import('@app/models/ShirabeConnection');
      const existing = {
        userId: 42,
        refreshTokenCiphertext: sealRefresh('shrr_old_refresh'),
        save: () => Promise.resolve(existing),
      };
      vi.mocked(ShirabeConnection.findOne).mockResolvedValueOnce(existing as never);
      const fetchMock = mockShirabe();
      const { state } = startLink(42);

      await completeLink(42, 'the-code', state);

      const revoke = fetchMock.mock.calls.find(([url]) => String(url).includes('/oauth/revoke'));
      expect(JSON.parse(revoke?.[1]?.body ?? '{}').token).toBe('shrr_old_refresh');
    });

    // Best effort, and after the new pair is in hand: a reader whose old grant
    // cannot be revoked still gets the link they asked for.
    it('still links when the old grant cannot be revoked', async () => {
      const { ShirabeConnection } = await import('@app/models/ShirabeConnection');
      const existing = {
        userId: 42,
        refreshTokenCiphertext: sealRefresh('shrr_old_refresh'),
        save() {
          saved.push(this as never);
          return Promise.resolve(this);
        },
      };
      vi.mocked(ShirabeConnection.findOne).mockResolvedValueOnce(existing as never);
      vi.stubGlobal(
        'fetch',
        vi.fn(async (url: URL | string) => {
          if (String(url).includes('/oauth/revoke')) throw new Error('shirabe is down');
          if (String(url).includes('/oauth/token')) {
            return Response.json({
              access_token: 'shra_the_access',
              refresh_token: 'shrr_the_refresh',
              expires_in: 3600,
              scope: 'READ_DICTIONARY READ_ACCOUNT',
            });
          }
          return Response.json({ credential: { scopes: ['READ_DICTIONARY', 'READ_ACCOUNT'] }, preferences: {} });
        }),
      );
      const { state } = startLink(42);

      await completeLink(42, 'the-code', state);
      expect(saved).toHaveLength(1);
    });

    // Revoking the old grant first left the reader with a row pointing at a dead
    // grant if the write then failed: store, then revoke.
    it('stores the new link before revoking the grant it replaces', async () => {
      const { ShirabeConnection } = await import('@app/models/ShirabeConnection');
      const order: string[] = [];
      const existing = {
        userId: 42,
        refreshTokenCiphertext: sealRefresh('shrr_old_refresh'),
        save() {
          order.push('save');
          return Promise.resolve(this);
        },
      };
      vi.mocked(ShirabeConnection.findOne).mockResolvedValueOnce(existing as never);
      const fetchMock = mockShirabe();
      fetchMock.mockImplementation(async (url: URL | string, init?: ShirabeRequest) => {
        if (String(url).includes('/oauth/revoke')) {
          order.push(`revoke ${JSON.parse(init?.body ?? '{}').token}`);
          return new Response(null, { status: 200 });
        }
        if (String(url).includes('/oauth/token')) {
          return Response.json({
            access_token: 'shra_the_access',
            refresh_token: 'shrr_the_refresh',
            expires_in: 3600,
            scope: 'READ_DICTIONARY READ_ACCOUNT',
          });
        }
        return Response.json({ credential: { scopes: ['READ_DICTIONARY', 'READ_ACCOUNT'] }, preferences: {} });
      });
      const { state } = startLink(42);

      await completeLink(42, 'the-code', state);

      expect(order).toEqual(['save', 'revoke shrr_old_refresh']);
    });

    it('stores nothing when the freshly granted token cannot read the account', async () => {
      const { state } = startLink(42);
      vi.stubGlobal(
        'fetch',
        vi.fn(async (url: URL | string) =>
          String(url).includes('/oauth/token')
            ? Response.json({
                access_token: 'shra_the_access',
                refresh_token: 'shrr_the_refresh',
                expires_in: 3600,
                scope: 'READ_DICTIONARY READ_ACCOUNT',
              })
            : new Response('nope', { status: 403 }),
        ),
      );

      await expect(completeLink(42, 'the-code', state)).rejects.toThrow(/would not complete/);
      expect(saved).toHaveLength(0);
    });
  });
});

describe('getReaderAccessToken', () => {
  beforeEach(() => {
    saved.length = 0;
    updates.length = 0;
    lockedConnection = null;
    vi.restoreAllMocks();
  });

  it('hands out the stored access token untouched while it has time left', async () => {
    const connection = storedConnection();
    const { ShirabeConnection } = await import('@app/models/ShirabeConnection');
    vi.mocked(ShirabeConnection.findOne).mockResolvedValue(connection as never);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    expect(await getReaderAccessToken(STORED_USER_ID)).toBe('shra_reader_access');
    expect(fetchMock, 'no renewal while the token is fresh').not.toHaveBeenCalled();
  });

  it('renews under the lock when the access token is nearly out, and stores the new pair', async () => {
    const connection = storedConnection({ accessTokenExpiresAt: new Date(Date.now() + 10 * 1000) });
    lockedConnection = connection;
    const { ShirabeConnection } = await import('@app/models/ShirabeConnection');
    vi.mocked(ShirabeConnection.findOne).mockResolvedValue(connection as never);
    const fetchMock = mockShirabe();

    expect(await getReaderAccessToken(STORED_USER_ID)).toBe('shra_renewed_access');

    const refresh = fetchMock.mock.calls.find(([url]) => String(url).includes('/oauth/token'));
    const body = JSON.parse(refresh?.[1]?.body ?? '{}');
    expect(body.grant_type).toBe('refresh_token');
    expect(body.refresh_token).toBe('shrr_reader_refresh');
    // The renewed refresh token replaces the old one on the row.
    expect(String(connection.refreshTokenCiphertext)).not.toEqual(sealRefresh('shrr_reader_refresh'));
    expect(saved).toContain(connection);
  });

  it('marks the link disconnected and hands out nothing when Shirabe will not renew', async () => {
    const connection = storedConnection({ accessTokenExpiresAt: new Date(Date.now() + 10 * 1000) });
    lockedConnection = connection;
    const { ShirabeConnection } = await import('@app/models/ShirabeConnection');
    vi.mocked(ShirabeConnection.findOne).mockResolvedValue(connection as never);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{"error":"invalid_grant"}', { status: 400 })),
    );

    expect(await getReaderAccessToken(STORED_USER_ID)).toBeNull();
    expect(connection.disconnectedAt).toBeInstanceOf(Date);
  });

  it('falls back to the token we hold when a renewal fails transiently', async () => {
    const connection = storedConnection({ accessTokenExpiresAt: new Date(Date.now() + 10 * 1000) });
    lockedConnection = connection;
    const { ShirabeConnection } = await import('@app/models/ShirabeConnection');
    vi.mocked(ShirabeConnection.findOne).mockResolvedValue(connection as never);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('nope', { status: 503 })),
    );

    // A bad minute at Shirabe is not a dead link: use what we have, do not mark.
    expect(await getReaderAccessToken(STORED_USER_ID)).toBe('shra_reader_access');
    expect(connection.disconnectedAt).toBeNull();
  });

  it('does not renew twice when a second request finds the lock already refreshed', async () => {
    // The stored row is due; the row the lock returns has already been renewed
    // by another worker (fresh expiry). The second request must return it
    // without spending the refresh token again.
    const stale = storedConnection({ accessTokenExpiresAt: new Date(Date.now() + 10 * 1000) });
    lockedConnection = storedConnection({ accessTokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000) });
    const { ShirabeConnection } = await import('@app/models/ShirabeConnection');
    vi.mocked(ShirabeConnection.findOne).mockResolvedValue(stale as never);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    expect(await getReaderAccessToken(STORED_USER_ID)).toBe('shra_reader_access');
    expect(fetchMock, 'the other worker already renewed').not.toHaveBeenCalled();
  });

  it('hands out nothing for a link already known to be over', async () => {
    const connection = storedConnection({
      disconnectedAt: new Date(),
      accessTokenExpiresAt: new Date(Date.now() - 1000),
    });
    const { ShirabeConnection } = await import('@app/models/ShirabeConnection');
    vi.mocked(ShirabeConnection.findOne).mockResolvedValue(connection as never);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    expect(await getReaderAccessToken(STORED_USER_ID)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('resyncStack', () => {
  beforeEach(() => {
    saved.length = 0;
    updates.length = 0;
    lockedConnection = null;
    vi.restoreAllMocks();
  });

  it('re-reads the stack from Shirabe when the fingerprint has moved', async () => {
    const connection = storedConnection();
    const { ShirabeConnection } = await import('@app/models/ShirabeConnection');
    vi.mocked(ShirabeConnection.findOne).mockResolvedValue(connection as never);
    const fetchMock = vi.fn(async () =>
      Response.json({ preferences: { dictionaries: ['sanseido:ja'], stackFingerprint: 'def456' } }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await resyncStack(STORED_USER_ID, 'def456');

    expect(connection.stackFingerprint).toBe('def456');
    expect(connection.stack).toEqual(['sanseido:ja']);
  });

  it('records the confirmation without a round trip when nothing changed', async () => {
    const connection = storedConnection();
    const { ShirabeConnection } = await import('@app/models/ShirabeConnection');
    vi.mocked(ShirabeConnection.findOne).mockResolvedValue(connection as never);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await resyncStack(STORED_USER_ID, 'abc123');

    expect(fetchMock).not.toHaveBeenCalled();
    // The date and nothing else: a confirmation must not be able to carry a
    // stale token pair back with it.
    expect(updates).toEqual([{ criteria: { userId: STORED_USER_ID }, patch: { syncedAt: connection.syncedAt } }]);
    expect(connection.syncedAt.getTime()).toBeGreaterThan(new Date('2026-01-01T00:00:00Z').getTime());
  });

  it('does nothing, loudly or otherwise, for a reader with no link', async () => {
    const { ShirabeConnection } = await import('@app/models/ShirabeConnection');
    vi.mocked(ShirabeConnection.findOne).mockResolvedValue(null as never);

    await expect(resyncStack(STORED_USER_ID, 'abc123')).resolves.toBeUndefined();
  });
});

describe('refreshStack', () => {
  beforeEach(() => {
    saved.length = 0;
    updates.length = 0;
    lockedConnection = null;
    vi.restoreAllMocks();
  });

  it('re-reads the stack with a fresh access token', async () => {
    const connection = storedConnection();
    const { ShirabeConnection } = await import('@app/models/ShirabeConnection');
    vi.mocked(ShirabeConnection.findOne).mockResolvedValue(connection as never);
    mockShirabe();

    await refreshStack(connection as never);

    expect(connection.stack).toEqual(['sanseido:ja', 'jmdict:en']);
    expect(connection.disconnectedAt).toBeNull();
  });

  it('marks the link over when Shirabe will not renew the grant', async () => {
    const connection = storedConnection({ accessTokenExpiresAt: new Date(Date.now() + 10 * 1000) });
    lockedConnection = connection;
    const { ShirabeConnection } = await import('@app/models/ShirabeConnection');
    vi.mocked(ShirabeConnection.findOne).mockResolvedValue(connection as never);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{"error":"invalid_grant"}', { status: 400 })),
    );

    await refreshStack(connection as never);

    expect(connection.disconnectedAt).toBeInstanceOf(Date);
  });

  it('leaves the link alone when Shirabe is simply unhappy', async () => {
    for (const status of [429, 500]) {
      saved.length = 0;
      updates.length = 0;
      const connection = storedConnection();
      const { ShirabeConnection } = await import('@app/models/ShirabeConnection');
      vi.mocked(ShirabeConnection.findOne).mockResolvedValue(connection as never);
      // Access token is fresh, so no renewal: /me itself answers unhappy.
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => new Response('nope', { status })),
      );

      await refreshStack(connection as never);

      expect(connection.disconnectedAt, `status ${status} must not end the link`).toBeNull();
    }
  });

  /**
   * The bug this exists for, and it was not theoretical: readers were told to
   * reconnect within hours of connecting, again and again, and the log said
   * Shirabe had ended their grant.
   *
   * What really happened is here. The caller's instance is read BEFORE
   * `getReaderAccessToken` renews, the renewal rotates the pair on the row it
   * locked -- a different object, as it is in Postgres -- and a whole-entity
   * `save()` afterwards writes the caller's now-spent pair back over it.
   * Nothing looks wrong until the next renewal presents a refresh token Shirabe
   * has already seen, which is `invalid_grant`, which is the grant over.
   *
   * The fixtures are deliberately two objects. One would pass this test while
   * production kept failing, which is exactly what the old tests did.
   */
  it('never writes the token pair back over a renewal it did not make', async () => {
    const held = storedConnection({ accessTokenExpiresAt: new Date(Date.now() + 10 * 1000) });
    lockedConnection = storedConnection({ accessTokenExpiresAt: new Date(Date.now() + 10 * 1000) });
    const { ShirabeConnection } = await import('@app/models/ShirabeConnection');
    vi.mocked(ShirabeConnection.findOne).mockResolvedValue(held as never);
    mockShirabe();

    await refreshStack(held as never);

    // The renewal rotated the pair on the row it locked, and that is the copy
    // that has to survive this call.
    expect(readAccessToken(lockedConnection as never)).toBe('shra_renewed_access');
    expect(saved, 'a stack read must not save the whole entity').not.toContain(held);

    const patch = updates.at(-1)?.patch ?? {};
    for (const column of ['accessTokenCiphertext', 'refreshTokenCiphertext', 'accessTokenExpiresAt']) {
      expect(Object.keys(patch), `a stack read must not write ${column}`).not.toContain(column);
    }
    expect(patch.stackFingerprint).toBe('9f2c1b7d4a0e6835');
    expect(patch.disconnectedAt).toBeNull();
  });

  it('marks a link over without writing the token pair back', async () => {
    // Same shape, the failing branch: the renewal succeeded, `/me` then answered
    // 401 because the grant was revoked in between. The mark must travel alone.
    const held = storedConnection({ accessTokenExpiresAt: new Date(Date.now() + 10 * 1000) });
    lockedConnection = storedConnection({ accessTokenExpiresAt: new Date(Date.now() + 10 * 1000) });
    const { ShirabeConnection } = await import('@app/models/ShirabeConnection');
    vi.mocked(ShirabeConnection.findOne).mockResolvedValue(held as never);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: URL | string) => {
        if (String(url).includes('/oauth/token')) {
          return Response.json({
            access_token: 'shra_renewed_access',
            refresh_token: 'shrr_renewed_refresh',
            expires_in: 3600,
          });
        }
        return new Response('nope', { status: 401 });
      }),
    );

    await refreshStack(held as never);

    expect(held.disconnectedAt).toBeInstanceOf(Date);
    expect(saved).not.toContain(held);
    expect(Object.keys(updates.at(-1)?.patch ?? {})).toEqual(['disconnectedAt']);
  });

  it('brings a link back when Shirabe answers again', async () => {
    const connection = storedConnection({ disconnectedAt: new Date('2026-01-01T00:00:00Z') });
    // A disconnected row hands out no token, so refreshStack has nothing to send
    // and returns what it holds -- the reader reconnects through completeLink.
    const { ShirabeConnection } = await import('@app/models/ShirabeConnection');
    vi.mocked(ShirabeConnection.findOne).mockResolvedValue(storedConnection() as never);
    mockShirabe();

    const result = await refreshStack(connection as never);
    expect(result.disconnectedAt).toBeNull();
  });
});

describe('reencryptTokens', () => {
  beforeEach(() => {
    saved.length = 0;
    updates.length = 0;
    vi.restoreAllMocks();
  });

  it('leaves a row already sealed with the current key alone', async () => {
    const connection = storedConnection();
    const before = connection.accessTokenCiphertext;

    expect(await reencryptTokens(connection as never)).toBe(false);
    expect(connection.accessTokenCiphertext).toBe(before);
    expect(saved).toHaveLength(0);
  });

  it('moves both ciphertexts sealed with the previous key onto the current one', async () => {
    const OLD = 'the-outgoing-connection-secret-x';
    const connection = storedConnection({
      accessTokenCiphertext: encryptSecret('shra_reader_access', OLD, accessContext()),
      refreshTokenCiphertext: encryptSecret('shrr_reader_refresh', OLD, refreshContext()),
    });
    (CONFIG as Record<string, unknown>).SHIRABE_CONNECTION_SECRET_PREVIOUS = OLD;

    try {
      expect(await reencryptTokens(connection as never)).toBe(true);
      // Same tokens underneath, still bound to the same reader.
      expect(readAccessToken(connection as never)).toBe('shra_reader_access');
      // And a second pass is a no-op.
      expect(await reencryptTokens(connection as never)).toBe(false);
    } finally {
      delete (CONFIG as Record<string, unknown>).SHIRABE_CONNECTION_SECRET_PREVIOUS;
    }
  });
});

describe('unlink', () => {
  beforeEach(() => {
    saved.length = 0;
    updates.length = 0;
    vi.restoreAllMocks();
  });

  it('hands the grant back to Shirabe and forgets the row', async () => {
    const removed = vi.fn(async () => undefined);
    const connection = storedConnection({ remove: removed });
    const { ShirabeConnection } = await import('@app/models/ShirabeConnection');
    vi.mocked(ShirabeConnection.findOne).mockResolvedValue(connection as never);
    const fetchMock = vi.fn(async (_url: URL | string, _init: ShirabeRequest) => new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    expect(await unlink(STORED_USER_ID)).toBe(true);

    const call = fetchMock.mock.calls[0];
    expect(String(call?.[0])).toContain('/oauth/revoke');
    expect(JSON.parse(call?.[1].body).token).toBe('shrr_reader_refresh');
    expect(removed).toHaveBeenCalledOnce();
  });

  it('still forgets a link whose refresh token cannot be read', async () => {
    const removed = vi.fn(async () => undefined);
    const connection = storedConnection({ refreshTokenCiphertext: 'v2.deadbeef.not.a.ciphertext', remove: removed });
    const { ShirabeConnection } = await import('@app/models/ShirabeConnection');
    vi.mocked(ShirabeConnection.findOne).mockResolvedValue(connection as never);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    expect(await unlink(STORED_USER_ID)).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(removed).toHaveBeenCalledOnce();
  });
});

describe('refreshIfStale', () => {
  beforeEach(() => {
    saved.length = 0;
    updates.length = 0;
    lockedConnection = null;
    vi.restoreAllMocks();
  });

  it('calls a copy stale once it is a week old and not before', () => {
    const now = Date.parse('2026-08-19T12:00:00Z');
    expect(stackIsStale(new Date(now - STACK_STALE_MS + 1000), now)).toBe(false);
    expect(stackIsStale(new Date(now - STACK_STALE_MS - 1000), now)).toBe(true);
    expect(stackIsStale(null, now)).toBe(true);
  });

  it('re-reads a stale stack from Shirabe', async () => {
    const connection = storedConnection({ userId: 7001, syncedAt: new Date(Date.now() - STACK_STALE_MS - 1000) });
    const { ShirabeConnection } = await import('@app/models/ShirabeConnection');
    vi.mocked(ShirabeConnection.findOne).mockResolvedValue(connection as never);
    mockShirabe();

    await refreshIfStale(7001);

    expect(connection.stackFingerprint).toBe('9f2c1b7d4a0e6835');
    expect(updates.at(-1)?.criteria).toEqual({ userId: 7001 });
  });

  it('does not ask twice for the same reader within the hour', async () => {
    const connection = storedConnection({ userId: 7002, syncedAt: new Date(Date.now() - STACK_STALE_MS - 1000) });
    const { ShirabeConnection } = await import('@app/models/ShirabeConnection');
    vi.mocked(ShirabeConnection.findOne).mockResolvedValue(connection as never);
    const fetchMock = mockShirabe();

    await refreshIfStale(7002);
    await refreshIfStale(7002);

    const meCalls = fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/api/v1/me'));
    expect(meCalls).toHaveLength(1);
  });

  it('leaves a fresh copy alone', async () => {
    const connection = storedConnection({ userId: 7003, syncedAt: new Date() });
    const { ShirabeConnection } = await import('@app/models/ShirabeConnection');
    vi.mocked(ShirabeConnection.findOne).mockResolvedValue(connection as never);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await refreshIfStale(7003);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('never throws', async () => {
    const { ShirabeConnection } = await import('@app/models/ShirabeConnection');
    vi.mocked(ShirabeConnection.findOne).mockRejectedValue(new Error('the database is away'));

    await expect(refreshIfStale(7004)).resolves.toBeUndefined();
  });
});
