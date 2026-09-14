import { randomBytes } from 'node:crypto';
import { config } from '@config/config';
import { PatreonConnection } from '@app/models';
import { InvalidRequestError, ValidationFailedError } from '@app/errors';
import { decryptSecret, encryptSecret } from '@lib/secretBox';

const FLOW_TTL_MS = 10 * 60_000;
const MEMBERSHIP_FRESH_MS = 15 * 60_000;
const STATE_CONTEXT = { purpose: 'patreon.oauth-state' } as const;
const tokenContext = (kind: 'access' | 'refresh', userId: number) => ({
  purpose: `patreon.${kind}-token`,
  aad: String(userId),
});

interface PendingFlow {
  userId: number;
  nonce: string;
  expiresAt: number;
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
}

interface PatreonResource {
  id: string;
  type: string;
  attributes?: Record<string, unknown>;
  relationships?: Record<string, { data?: { id: string; type: string } | Array<{ id: string; type: string }> | null }>;
}

interface IdentityResponse {
  data: PatreonResource;
  included?: PatreonResource[];
}

function secret(): string {
  if (!config.PATREON_CONNECTION_SECRET) {
    throw new ValidationFailedError({ connection: 'Patreon linking is not configured on this server.' });
  }
  return config.PATREON_CONNECTION_SECRET;
}

function assertConfigured() {
  if (
    !config.PATREON_OAUTH_CLIENT_ID ||
    !config.PATREON_OAUTH_CLIENT_SECRET ||
    !config.PATREON_OAUTH_REDIRECT_URI ||
    !config.PATREON_CAMPAIGN_ID
  ) {
    throw new ValidationFailedError({ connection: 'Patreon linking is not configured on this server.' });
  }
  secret();
}

export function startPatreonLink(userId: number) {
  assertConfigured();
  const state = encryptSecret(
    JSON.stringify({ userId, nonce: randomBytes(24).toString('base64url'), expiresAt: Date.now() + FLOW_TTL_MS }),
    secret(),
    STATE_CONTEXT,
  );
  const authorizeUrl = new URL('https://www.patreon.com/oauth2/authorize');
  authorizeUrl.search = new URLSearchParams({
    response_type: 'code',
    client_id: config.PATREON_OAUTH_CLIENT_ID,
    redirect_uri: config.PATREON_OAUTH_REDIRECT_URI,
    scope: 'identity identity.memberships',
    state,
  }).toString();
  return { authorizeUrl: authorizeUrl.toString(), state };
}

function openState(state: string): PendingFlow {
  try {
    const flow = JSON.parse(decryptSecret(state, secret(), STATE_CONTEXT)) as PendingFlow;
    if (!flow.userId || !flow.nonce || flow.expiresAt < Date.now()) throw new Error('expired');
    return flow;
  } catch {
    throw new InvalidRequestError('This Patreon link request is invalid or expired. Start again.');
  }
}

async function tokenRequest(parameters: Record<string, string>): Promise<TokenResponse> {
  const response = await fetch('https://www.patreon.com/api/oauth2/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.PATREON_OAUTH_CLIENT_ID,
      client_secret: config.PATREON_OAUTH_CLIENT_SECRET,
      ...parameters,
    }),
  });
  if (!response.ok) throw new InvalidRequestError('Patreon could not complete the connection. Please try again.');
  return (await response.json()) as TokenResponse;
}

async function identity(accessToken: string): Promise<IdentityResponse> {
  const url = new URL('https://www.patreon.com/api/oauth2/v2/identity');
  url.searchParams.set('include', 'memberships');
  url.searchParams.set('fields[user]', 'full_name');
  url.searchParams.set('fields[member]', 'patron_status,currently_entitled_amount_cents');
  const response = await fetch(url, { headers: { authorization: `Bearer ${accessToken}` } });
  if (!response.ok) throw new InvalidRequestError('Patreon membership could not be verified. Please reconnect.');
  return (await response.json()) as IdentityResponse;
}

function membershipFrom(response: IdentityResponse) {
  const memberships = (response.included ?? []).filter((item) => item.type === 'member');
  const membership = memberships.find((item) => {
    const campaign = item.relationships?.campaign?.data;
    return !Array.isArray(campaign) && campaign?.id === config.PATREON_CAMPAIGN_ID;
  });
  const attrs = membership?.attributes ?? {};
  const campaign = membership?.relationships?.campaign?.data;
  return {
    memberId: membership?.id ?? null,
    campaignId: !Array.isArray(campaign) ? (campaign?.id ?? null) : null,
    patronStatus: typeof attrs.patron_status === 'string' ? attrs.patron_status : null,
    entitledAmountCents:
      typeof attrs.currently_entitled_amount_cents === 'number' ? attrs.currently_entitled_amount_cents : 0,
  };
}

export async function completePatreonLink(userId: number, code: string, state: string): Promise<PatreonConnection> {
  assertConfigured();
  const flow = openState(state);
  if (flow.userId !== userId) throw new InvalidRequestError('This Patreon link belongs to another account.');
  const token = await tokenRequest({
    grant_type: 'authorization_code',
    code,
    redirect_uri: config.PATREON_OAUTH_REDIRECT_URI,
  });
  if (!token.refresh_token) {
    throw new InvalidRequestError('Patreon did not provide a renewable connection. Please try linking again.');
  }
  const profile = await identity(token.access_token);
  const existingIdentity = await PatreonConnection.findOneBy({ patreonUserId: profile.data.id });
  if (existingIdentity && existingIdentity.userId !== userId) {
    throw new ValidationFailedError({
      connection: 'That Patreon account is already linked to another Nadeshiko account.',
    });
  }
  const connection = (await PatreonConnection.findOneBy({ userId })) ?? PatreonConnection.create({ userId });
  const member = membershipFrom(profile);
  connection.patreonUserId = profile.data.id;
  connection.accessTokenCiphertext = encryptSecret(token.access_token, secret(), tokenContext('access', userId));
  connection.refreshTokenCiphertext = encryptSecret(token.refresh_token, secret(), tokenContext('refresh', userId));
  connection.accessTokenExpiresAt = new Date(Date.now() + (token.expires_in ?? 2_592_000) * 1000);
  connection.fullName =
    typeof profile.data.attributes?.full_name === 'string' ? profile.data.attributes.full_name : null;
  Object.assign(connection, member, { membershipCheckedAt: new Date() });
  return connection.save();
}

async function refreshAccess(connection: PatreonConnection): Promise<string> {
  if (connection.accessTokenExpiresAt.getTime() > Date.now() + 60_000) {
    return decryptSecret(connection.accessTokenCiphertext, secret(), tokenContext('access', connection.userId));
  }
  const refreshToken = decryptSecret(
    connection.refreshTokenCiphertext,
    secret(),
    tokenContext('refresh', connection.userId),
  );
  const token = await tokenRequest({ grant_type: 'refresh_token', refresh_token: refreshToken });
  connection.accessTokenCiphertext = encryptSecret(
    token.access_token,
    secret(),
    tokenContext('access', connection.userId),
  );
  if (token.refresh_token) {
    connection.refreshTokenCiphertext = encryptSecret(
      token.refresh_token,
      secret(),
      tokenContext('refresh', connection.userId),
    );
  }
  connection.accessTokenExpiresAt = new Date(Date.now() + (token.expires_in ?? 2_592_000) * 1000);
  await connection.save();
  return token.access_token;
}

export async function getPatreonConnection(userId: number, force = false): Promise<PatreonConnection | null> {
  const connection = await PatreonConnection.findOneBy({ userId });
  if (!connection) return null;
  if (!force && Date.now() - connection.membershipCheckedAt.getTime() < MEMBERSHIP_FRESH_MS) return connection;
  const profile = await identity(await refreshAccess(connection));
  Object.assign(connection, membershipFrom(profile), { membershipCheckedAt: new Date() });
  return connection.save();
}

export async function unlinkPatreon(userId: number): Promise<boolean> {
  const result = await PatreonConnection.delete({ userId });
  return Boolean(result.affected);
}
