import { beforeEach, describe, expect, it, vi } from 'vitest';

const CONFIG = {
  PATREON_OAUTH_CLIENT_ID: 'nadeshiko-test',
  PATREON_OAUTH_CLIENT_SECRET: 'client-secret',
  PATREON_OAUTH_REDIRECT_URI: 'https://nadeshiko.test/link/patreon/callback',
  PATREON_CAMPAIGN_ID: 'campaign-42',
  PATREON_CONNECTION_SECRET: 'test-secret-with-more-than-thirty-two-characters',
};
vi.mock('@config/config', () => ({ config: CONFIG }));

const rows: Record<string, unknown>[] = [];
vi.mock('@app/models', () => ({
  PatreonConnection: {
    findOneBy: vi.fn(async () => null),
    create: vi.fn((attributes: Record<string, unknown>) => ({
      ...attributes,
      get active() {
        return this.patronStatus === 'active_patron' && Number(this.entitledAmountCents) > 0;
      },
      async save() {
        rows.push(this);
        return this;
      },
    })),
  },
}));

const { completePatreonLink, startPatreonLink } = await import('@app/services/patreon/connection');

function response(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}

beforeEach(() => {
  rows.length = 0;
  vi.restoreAllMocks();
});

describe('Patreon OAuth linking', () => {
  it('requests only identity and membership access and carries sealed state', () => {
    const link = startPatreonLink(7);
    const url = new URL(link.authorizeUrl);

    expect(url.origin + url.pathname).toBe('https://www.patreon.com/oauth2/authorize');
    expect(url.searchParams.get('scope')).toBe('identity identity.memberships');
    expect(url.searchParams.get('state')).toBe(link.state);
    expect(link.state).not.toContain('"userId":7');
  });

  it('marks only an active paid membership to the configured campaign as eligible', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(response({ access_token: 'access', refresh_token: 'refresh', expires_in: 3600 }))
      .mockResolvedValueOnce(
        response({
          data: { id: 'patreon-user', type: 'user', attributes: { full_name: 'Mika' } },
          included: [
            {
              id: 'member-1',
              type: 'member',
              attributes: { patron_status: 'active_patron', currently_entitled_amount_cents: 500 },
              relationships: { campaign: { data: { id: 'campaign-42', type: 'campaign' } } },
            },
          ],
        }),
      );
    const state = startPatreonLink(7).state;
    const connection = await completePatreonLink(7, 'one-time-code', state);

    expect(connection.active).toBe(true);
    expect(connection).toMatchObject({
      patreonUserId: 'patreon-user',
      campaignId: 'campaign-42',
      memberId: 'member-1',
      patronStatus: 'active_patron',
      entitledAmountCents: 500,
    });
    expect(fetchMock.mock.calls[1]?.[0].toString()).toContain('include=memberships');
    expect(String(connection.accessTokenCiphertext)).not.toContain('access');
    expect(String(connection.refreshTokenCiphertext)).not.toContain('refresh');
  });

  it('does not accept an active pledge to a different creator', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(response({ access_token: 'access', refresh_token: 'refresh', expires_in: 3600 }))
      .mockResolvedValueOnce(
        response({
          data: { id: 'patreon-user', type: 'user', attributes: {} },
          included: [
            {
              id: 'member-other',
              type: 'member',
              attributes: { patron_status: 'active_patron', currently_entitled_amount_cents: 10000 },
              relationships: { campaign: { data: { id: 'someone-else', type: 'campaign' } } },
            },
          ],
        }),
      );

    const connection = await completePatreonLink(7, 'code', startPatreonLink(7).state);
    expect(connection.active).toBe(false);
    expect(connection.entitledAmountCents).toBe(0);
  });

  it('rejects a link that cannot be renewed', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(response({ access_token: 'access', expires_in: 3600 }));

    await expect(completePatreonLink(7, 'code', startPatreonLink(7).state)).rejects.toThrow(
      'did not provide a renewable connection',
    );
  });

  it('rejects state issued for another Nadeshiko account', async () => {
    await expect(completePatreonLink(8, 'code', startPatreonLink(7).state)).rejects.toThrow(
      'belongs to another account',
    );
  });
});
