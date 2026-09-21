import { config } from '@config/config';
import { createShirabeClient } from '@shirabe-org/api/server';

export { ShirabeServiceAuthError } from '@shirabe-org/api/server';
export type ShirabeServiceCredential = Awaited<ReturnType<ReturnType<typeof createShirabeClient>['getCredential']>>;

/** Nadeshiko's machine identity for corpus work and default dictionary reads. */
const service = createShirabeClient({
  baseUrl: config.SHIRABE_API_BASE,
  clientId: config.SHIRABE_OAUTH_CLIENT_ID ?? '',
  clientSecret: config.SHIRABE_OAUTH_CLIENT_SECRET ?? '',
  scopes: ['dictionary:read'],
});

export const shirabeServiceAccessToken = service.getAccessToken;
export const shirabeServiceCredential = service.getCredential;
export const shirabeServiceClient = () => service;
export const __testing = { reset: service.clearCredentials };
