import { createHash } from 'node:crypto';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { encryptSecret } from '@lib/secretBox';

const CONFIG = {
  SHIRABE_API_BASE: 'https://shirabe.test',
  SHIRABE_OAUTH_CLIENT_ID: 'nadeshiko',
  SHIRABE_OAUTH_REDIRECT_URI: 'https://nadeshiko.co/link/shirabe/callback',
  SHIRABE_CONNECTION_SECRET: 'a-test-connection-secret',
};

vi.mock('@config/config', () => ({ config: CONFIG }));
vi.mock('@config/log', () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() } }));

const saved: Record<string, unknown>[] = [];
vi.mock('@app/models/ShirabeConnection', () => ({
  ShirabeConnection: {
    findOne: vi.fn(async () => null),
    create: vi.fn((attributes: Record<string, unknown>) => ({
      ...attributes,
      save() {
        saved.push(this as Record<string, unknown>);
        return Promise.resolve(this);
      },
    })),
  },
}));

const { startLink, completeLink, missingScopes, resyncStack, REQUIRED_SCOPES } = await import(
  '@app/services/shirabe/connection'
);

/** A stored link, in the shape the service reads and writes it. */
/** The reader every stored row here belongs to. The ciphertext is bound to it,
 *  so a fixture sealed for anyone else would fail to open -- which is the
 *  property being relied on rather than a detail of the fixture. */
const STORED_USER_ID = 42;
const TOKEN_CONTEXT = { purpose: 'shirabe.token', aad: String(STORED_USER_ID) };

function storedConnection(overrides: Record<string, unknown> = {}) {
  return {
    userId: STORED_USER_ID,
    tokenCiphertext: encryptSecret('shr_reader_key', CONFIG.SHIRABE_CONNECTION_SECRET, TOKEN_CONTEXT),
    stack: ['jmdict:en'],
    stackFingerprint: 'abc123',
    syncedAt: new Date('2026-01-01T00:00:00Z'),
    scopes: [...REQUIRED_SCOPES],
    save() {
      saved.push(this as Record<string, unknown>);
      return Promise.resolve(this);
    },
    ...overrides,
  };
}

/**
 * The link flow, and specifically the two things that are not about happy paths:
 * that the `state` is a sealed record rather than a lookup key, and that
 * finishing somebody else's flow is refused.
 */
describe('shirabe connection', () => {
  beforeEach(() => {
    saved.length = 0;
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('startLink', () => {
    it('sends the reader to Shirabe with everything the flow needs', () => {
      const { authorizeUrl } = startLink(42);
      const url = new URL(authorizeUrl);

      expect(url.origin).toBe('https://shirabe.test');
      expect(url.pathname).toBe('/oauth/authorize');
      expect(url.searchParams.get('client_id')).toBe('nadeshiko');
      expect(url.searchParams.get('redirect_uri')).toBe(CONFIG.SHIRABE_OAUTH_REDIRECT_URI);
      expect(url.searchParams.get('response_type')).toBe('code');
      expect(url.searchParams.get('code_challenge_method')).toBe('S256');
      expect(url.searchParams.get('code_challenge')).toBeTruthy();
    });

    // The scope we ask for is the scope the reader is asked to approve, so it is
    // worth pinning: nothing here writes to anyone's study data, and asking for
    // a permission with no feature behind it is what makes a person say no.
    //
    // READ_DICTIONARY is not optional company for READ_ACCOUNT, which this used
    // to assert it was. Every Shirabe API endpoint requires it by default and
    // `POST /words/identify` does not opt out, so a link without it can read the
    // reader's dictionary stack and never use it: `identify` 403s, our lookup
    // route quietly answers on the service key, and the reader sees the default
    // dictionaries with nothing reporting a problem.
    it('asks for exactly the two scopes a dictionary stack needs', () => {
      const url = new URL(startLink(42).authorizeUrl);

      expect(url.searchParams.get('scope')).toBe('READ_DICTIONARY READ_ACCOUNT');
    });

    // Nothing is stored anywhere, so two flows cannot collide and a flow started
    // on one container can be finished on another.
    it('seals a different state every time', () => {
      expect(startLink(42).state).not.toBe(startLink(42).state);
    });
  });

  // What a link is missing that this deployment needs. The whole scope-upgrade
  // flow hangs off this one comparison: it is what turns "connected" into
  // "connected, but a newer feature wants one more permission".
  describe('missingScopes', () => {
    it('is empty for a link carrying everything required', () => {
      expect(missingScopes({ scopes: [...REQUIRED_SCOPES] } as never)).toEqual([]);
    });

    it('names what a link granted before a scope was added does not carry', () => {
      expect(missingScopes({ scopes: [] } as never)).toEqual([...REQUIRED_SCOPES]);
    });

    // A key carrying MORE than we need is not an upgrade prompt: the reader
    // approved it, and asking them to approve again would be asking for nothing.
    it('ignores scopes granted beyond what is required', () => {
      expect(missingScopes({ scopes: [...REQUIRED_SCOPES, 'WRITE_SRS'] } as never)).toEqual([]);
    });

    it('treats a link with no scopes recorded as needing all of them', () => {
      expect(missingScopes({} as never)).toEqual([...REQUIRED_SCOPES]);
    });
  });

  describe('completeLink', () => {
    it('proves the redemption with the verifier the challenge was built from', async () => {
      const { authorizeUrl, state } = startLink(42);
      const challenge = new URL(authorizeUrl).searchParams.get('code_challenge');
      const fetchMock = mockShirabe();

      await completeLink(42, 'the-code', state);

      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body.code).toBe('the-code');
      expect(createHash('sha256').update(body.code_verifier).digest('base64url')).toBe(challenge);
    });

    it('stores the key encrypted, never in the clear', async () => {
      const { state } = startLink(42);
      mockShirabe();

      await completeLink(42, 'the-code', state);

      const [connection] = saved;
      expect(connection.tokenCiphertext).not.toContain('shr_the_key');
      // Format version, then the id of the key that sealed it -- which is what
      // lets a later rotation tell old rows from new ones.
      expect(String(connection.tokenCiphertext)).toMatch(/^v2\.[0-9a-f]{8}\./);
      expect(connection.tokenPrefix).toBe('shr_the_key'.slice(0, 12));
    });

    it('copies the stack the lookups will be cached by', async () => {
      const { state } = startLink(42);
      mockShirabe();

      await completeLink(42, 'the-code', state);

      const [connection] = saved;
      expect(connection.stack).toEqual(['sanseido:ja', 'jmdict:en']);
      expect(connection.stackFingerprint).toBe('9f2c1b7d4a0e6835');
      expect(connection.stackIsPrivate).toBe(false);
      expect(connection.shirabeName).toBe('Lumi');
    });

    // The attack this stops: somebody completes their OWN authorization at
    // Shirabe, then hands the resulting callback URL to a signed-in victim. If
    // the state were merely "a valid state", the victim's account would end up
    // linked to the attacker's Shirabe account, and every word the victim looked
    // up would be shaped by it.
    it('refuses a state that belongs to a different account', async () => {
      const { state } = startLink(42);
      const fetchMock = mockShirabe();

      await expect(completeLink(99, 'the-code', state)).rejects.toThrow(/different account/);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('refuses a state we did not seal', async () => {
      const fetchMock = mockShirabe();

      await expect(completeLink(42, 'the-code', 'v1.AAAA.BBBB.CCCC')).rejects.toThrow(/not valid/);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('refuses a state that has expired', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-08-17T09:00:00Z'));
      const { state } = startLink(42);
      vi.setSystemTime(new Date('2026-08-17T09:16:00Z'));
      mockShirabe();

      await expect(completeLink(42, 'the-code', state)).rejects.toThrow(/expired/);
    });

    // Nothing is stored until Shirabe has answered both calls. A row holding a
    // token we never successfully used is a link that looks fine on the settings
    // page and fails on the first lookup.
    it('stores nothing when Shirabe rejects the code', async () => {
      const { state } = startLink(42);
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => new Response('{"error":"invalid_grant"}', { status: 400 })),
      );

      await expect(completeLink(42, 'the-code', state)).rejects.toThrow(/would not complete/);
      expect(saved).toHaveLength(0);
    });

    // The scope-upgrade failure mode that has no error anywhere: Shirabe narrows
    // a request to what the CLIENT is registered for, so a scope added on this
    // side and not on the registration is granted short and silently. Storing it
    // would leave the reader on a settings page that keeps asking them to approve
    // permissions they just approved, with nothing saying the fault is ours.
    it('refuses a grant that came back missing a required scope', async () => {
      const { state } = startLink(42);
      mockShirabe([]);

      await expect(completeLink(42, 'the-code', state)).rejects.toThrow(/could not grant everything/);
      expect(saved).toHaveLength(0);
    });

    // Re-consent is how a scope upgrade happens, and it goes through this same
    // path every time. Shirabe mints a NEW key for the wider grant, so without
    // this the reader collects a live orphaned key on their Shirabe access list
    // per upgrade -- credentials granted to us that we can no longer reach.
    it('revokes the key it is replacing when a link is redone', async () => {
      const { ShirabeConnection } = await import('@app/models/ShirabeConnection');
      const existing = {
        userId: 42,
        tokenCiphertext: encryptSecret('shr_the_old_key', CONFIG.SHIRABE_CONNECTION_SECRET, TOKEN_CONTEXT),
        save: () => Promise.resolve(existing),
      };
      vi.mocked(ShirabeConnection.findOne).mockResolvedValueOnce(existing as never);
      const fetchMock = mockShirabe();
      const { state } = startLink(42);

      await completeLink(42, 'the-code', state);

      const revoke = fetchMock.mock.calls.find(([url]) => String(url).includes('/me/key'));
      expect(revoke, 'the old key is handed back to Shirabe').toBeTruthy();
      expect(revoke?.[1].method).toBe('DELETE');
      expect(revoke?.[1].headers.authorization).toBe('Bearer shr_the_old_key');
    });

    // Best effort, and after the new key is in hand: a reader whose old key
    // cannot be revoked still gets the link they asked for.
    it('still links when the old key cannot be revoked', async () => {
      const { ShirabeConnection } = await import('@app/models/ShirabeConnection');
      const existing = {
        userId: 42,
        tokenCiphertext: encryptSecret('shr_the_old_key', CONFIG.SHIRABE_CONNECTION_SECRET, TOKEN_CONTEXT),
        save() {
          saved.push(this as never);
          return Promise.resolve(this);
        },
      };
      vi.mocked(ShirabeConnection.findOne).mockResolvedValueOnce(existing as never);
      vi.stubGlobal(
        'fetch',
        vi.fn(async (url: URL | string) => {
          if (String(url).includes('/me/key')) throw new Error('shirabe is down');
          if (String(url).includes('/oauth/token')) {
            return Response.json({ apiKey: 'shr_the_key', scopes: ['READ_DICTIONARY', 'READ_ACCOUNT'] });
          }
          return Response.json({
            user: { name: 'Lumi' },
            key: { scopes: ['READ_DICTIONARY', 'READ_ACCOUNT'] },
            preferences: {},
          });
        }),
      );
      const { state } = startLink(42);

      await completeLink(42, 'the-code', state);

      expect(saved).toHaveLength(1);
    });

    it('stores nothing when the freshly minted key cannot read the account', async () => {
      const { state } = startLink(42);
      vi.stubGlobal(
        'fetch',
        vi.fn(async (url: URL | string) =>
          String(url).includes('/oauth/token')
            ? Response.json({ apiKey: 'shr_the_key', scopes: ['READ_DICTIONARY', 'READ_ACCOUNT'] })
            : new Response('nope', { status: 403 }),
        ),
      );

      await expect(completeLink(42, 'the-code', state)).rejects.toThrow(/would not complete/);
      expect(saved).toHaveLength(0);
    });
  });
});

/**
 * Just the parts of a request the assertions read back. Narrower than
 * `RequestInit`, and deliberately: `body` there is a `BodyInit` and `headers` a
 * `HeadersInit`, neither of which can be indexed or parsed without a cast at
 * every call site. Every request this double answers is made by `connection.ts`,
 * which sends all three.
 */
type ShirabeRequest = { method: string; body: string; headers: Record<string, string> };

/** Shirabe answering the calls a link makes: the token exchange, then /me, plus
 *  the revoke a relink fires at the key it is replacing. */
function mockShirabe(granted: string[] = ['READ_DICTIONARY', 'READ_ACCOUNT']) {
  const fetchMock = vi.fn(async (url: URL | string, _init: ShirabeRequest) => {
    if (String(url).includes('/oauth/token')) {
      return Response.json({ apiKey: 'shr_the_key', scopes: granted });
    }
    if (String(url).includes('/me/key')) return new Response(null, { status: 204 });
    return Response.json({
      user: { name: 'lumi', displayName: 'Lumi' },
      key: { scopes: granted },
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

/**
 * Reconciling the stored stack against what a lookup actually saw.
 *
 * This is what makes a dictionary the reader switched off in Shirabe stop being
 * served to them: the fingerprint is what their cached word cards are keyed by,
 * and this is the only thing that moves it between the periodic sweeps.
 */
describe('resyncStack', () => {
  beforeEach(() => {
    saved.length = 0;
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

    await resyncStack(42, 'def456');

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(connection.stackFingerprint).toBe('def456');
    expect(connection.stack).toEqual(['sanseido:ja']);
  });

  // The other half, and the one that keeps this affordable: a lookup that agrees
  // with what we hold has just confirmed it first-hand, so there is nothing to
  // ask Shirabe.
  it('records the confirmation without a round trip when nothing changed', async () => {
    const connection = storedConnection();
    const { ShirabeConnection } = await import('@app/models/ShirabeConnection');
    vi.mocked(ShirabeConnection.findOne).mockResolvedValue(connection as never);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await resyncStack(42, 'abc123');

    expect(fetchMock).not.toHaveBeenCalled();
    expect(saved).toContain(connection);
    expect(connection.syncedAt.getTime()).toBeGreaterThan(new Date('2026-01-01T00:00:00Z').getTime());
  });

  // It is called without being awaited, from a request that has already
  // answered. There is nothing above it that could handle a throw.
  it('does nothing, loudly or otherwise, for a reader with no link', async () => {
    const { ShirabeConnection } = await import('@app/models/ShirabeConnection');
    vi.mocked(ShirabeConnection.findOne).mockResolvedValue(null as never);

    await expect(resyncStack(42, 'abc123')).resolves.toBeUndefined();
  });
});
