// @vitest-environment happy-dom
import { mount } from '@vue/test-utils';
import { afterEach, describe, expect, test, vi } from 'vitest';

const navigateTo = vi.fn();
const route: { query: { token: string; callbackURL?: string } } = { query: { token: 'token-123' } };

vi.stubGlobal('useRoute', () => route);
vi.stubGlobal('useRequestURL', () => new URL('https://nadeshiko.co/verify?token=token-123'));
vi.stubGlobal('useLocalePath', () => (path: string) => `/en${path}`);
vi.stubGlobal('navigateTo', navigateTo);
vi.stubGlobal('createError', (error: unknown) => error);

import VerifyPage from './verify.vue';

afterEach(() => vi.clearAllMocks());

describe('legacy email verification links', () => {
  test('forward the token to Better Auth and return to account settings', () => {
    mount(VerifyPage);

    expect(navigateTo).toHaveBeenCalledWith(
      'https://nadeshiko.co/v1/auth/verify-email?token=token-123&callbackURL=https%3A%2F%2Fnadeshiko.co%2Fuser%2Fsettings',
      { external: true, redirectCode: 302 },
    );
  });

  test('does not allow a cross-origin callback URL', async () => {
    route.query = { token: 'token-123', callbackURL: 'https://evil.example/' };
    mount(VerifyPage);

    expect(navigateTo).toHaveBeenCalledWith(
      'https://nadeshiko.co/v1/auth/verify-email?token=token-123&callbackURL=https%3A%2F%2Fnadeshiko.co%2Fuser%2Fsettings',
      { external: true, redirectCode: 302 },
    );
  });
});
