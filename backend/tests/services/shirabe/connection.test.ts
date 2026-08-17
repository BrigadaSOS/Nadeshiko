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

const { startLink, completeLink, missingScopes, REQUIRED_SCOPES } = await import('@app/services/shirabe/connection');

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
    it('asks for READ_ACCOUNT and nothing else', () => {
      const url = new URL(startLink(42).authorizeUrl);

      expect(url.searchParams.get('scope')).toBe('READ_ACCOUNT');
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
      expect(String(connection.tokenCiphertext)).toMatch(/^v1\./);
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
        tokenCiphertext: encryptSecret('shr_the_old_key', CONFIG.SHIRABE_CONNECTION_SECRET),
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
        tokenCiphertext: encryptSecret('shr_the_old_key', CONFIG.SHIRABE_CONNECTION_SECRET),
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
            return Response.json({ apiKey: 'shr_the_key', scopes: ['READ_ACCOUNT'] });
          }
          return Response.json({ user: { name: 'Lumi' }, key: { scopes: ['READ_ACCOUNT'] }, preferences: {} });
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
            ? Response.json({ apiKey: 'shr_the_key', scopes: ['READ_ACCOUNT'] })
            : new Response('nope', { status: 403 }),
        ),
      );

      await expect(completeLink(42, 'the-code', state)).rejects.toThrow(/would not complete/);
      expect(saved).toHaveLength(0);
    });
  });
});

/** Shirabe answering the calls a link makes: the token exchange, then /me, plus
 *  the revoke a relink fires at the key it is replacing. */
function mockShirabe(granted: string[] = ['READ_ACCOUNT']) {
  const fetchMock = vi.fn(async (url: URL | string) => {
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
