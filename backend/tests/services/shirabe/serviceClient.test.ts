import { describe, expect, test, vi } from 'vitest';

const { createShirabeClient, getAccessToken, getCredential, clearCredentials, parse } = vi.hoisted(() => ({
  createShirabeClient: vi.fn(),
  getAccessToken: vi.fn().mockResolvedValue('short-lived-bearer'),
  getCredential: vi.fn().mockResolvedValue({ token: 'short-lived-bearer', expiresAt: 1000 }),
  clearCredentials: vi.fn(),
  parse: vi.fn(),
}));

vi.mock('@config/config', () => ({
  config: {
    SHIRABE_API_BASE: 'https://shirabe.test/',
    SHIRABE_OAUTH_CLIENT_ID: 'nadeshiko',
    SHIRABE_OAUTH_CLIENT_SECRET: 'test-secret',
  },
}));
vi.mock('@shirabe-org/api/server', () => ({
  createShirabeClient: createShirabeClient.mockReturnValue({ getAccessToken, getCredential, clearCredentials, parse }),
  ShirabeServiceAuthError: class ShirabeServiceAuthError extends Error {},
}));

import {
  __testing,
  shirabeServiceAccessToken,
  shirabeServiceClient,
  shirabeServiceCredential,
} from '@app/services/shirabe/serviceClient';

describe('Nadeshiko Shirabe service connection', () => {
  test('configures the SDK with its machine identity and typed dictionary scope', async () => {
    expect(createShirabeClient).toHaveBeenCalledWith({
      baseUrl: 'https://shirabe.test/',
      clientId: 'nadeshiko',
      clientSecret: 'test-secret',
      scopes: ['dictionary:read'],
    });
    await expect(shirabeServiceAccessToken()).resolves.toBe('short-lived-bearer');
    await expect(shirabeServiceCredential()).resolves.toEqual({ token: 'short-lived-bearer', expiresAt: 1000 });
    expect(shirabeServiceClient().parse).toBe(parse);
    __testing.reset();
    expect(clearCredentials).toHaveBeenCalled();
  });
});
