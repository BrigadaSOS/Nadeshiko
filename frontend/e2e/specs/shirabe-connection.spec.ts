import type { Page, Route } from '@playwright/test';

import { expect, test } from '../auth';
import { getE2EBaseUrl } from '../env';
import { SettingsPage } from '../pages/SettingsPage';

type Connection = {
  needsUpgrade: boolean;
  missingScopes: string[];
  disconnected: boolean;
  linkedAt: string;
  shirabeName: string | null;
  scopes: string[];
  dictionaries: string[];
  dictionaryNames: Record<string, string>;
  stackIsPrivate: boolean;
  syncedAt: string | null;
};

const linkedConnection: Connection = {
  needsUpgrade: false,
  missingScopes: [],
  disconnected: false,
  linkedAt: '2026-09-13T00:00:00.000Z',
  shirabeName: 'Lumi',
  scopes: ['READ_DICTIONARY'],
  dictionaries: ['jmdict:en', 'jmdict:ja'],
  dictionaryNames: { jmdict: 'JMdict' },
  stackIsPrivate: false,
  syncedAt: '2026-09-13T00:00:00.000Z',
};

async function mockConnectionEndpoint(
  page: Page,
  options: {
    connection: Connection | null;
    authorizeUrl?: string;
    onDelete?: () => Promise<void> | void;
  },
) {
  const methods: string[] = [];

  await page.route('**/v1/user/connections/shirabe', async (route: Route) => {
    const method = route.request().method();
    methods.push(method);

    if (method === 'GET') {
      return route.fulfill({ json: { connection: options.connection } });
    }

    if (method === 'POST') {
      return route.fulfill({
        json: {
          authorizeUrl:
            options.authorizeUrl ?? 'https://shirabe.example.test/oauth/authorize?state=test-state',
        },
      });
    }

    if (method === 'DELETE') {
      await options.onDelete?.();
      return route.fulfill({ status: 204, body: '' });
    }

    return route.fallback();
  });

  return methods;
}

async function mockCallback(page: Page, response: { status?: number; connection?: { shirabeName: string | null } }) {
  let body: Record<string, unknown> | null = null;
  await page.route('**/v1/user/connections/shirabe/callback', async (route: Route) => {
    body = route.request().postDataJSON() as Record<string, unknown>;
    if (response.status) {
      return route.fulfill({
        status: response.status,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'callback failed' }),
      });
    }

    return route.fulfill({ json: { connection: response.connection ?? { shirabeName: 'Lumi' } } });
  });
  return () => body;
}

test.describe('Shirabe connection', () => {
  test('completes the consent journey and scrubs the one-time callback query', async ({ authenticatedPage }) => {
    const callbackUrl = new URL('/link/shirabe/callback?code=oauth-code&state=sealed-state', getE2EBaseUrl());
    await mockConnectionEndpoint(authenticatedPage, {
      connection: null,
      authorizeUrl: callbackUrl.toString(),
    });
    const callbackBody = await mockCallback(authenticatedPage, { connection: { shirabeName: 'Lumi' } });

    const settings = new SettingsPage(authenticatedPage);
    await settings.goto();
    await settings.expectLoaded();

    const toggle = authenticatedPage.getByTestId('shirabe-connection-toggle');
    await expect(toggle).toHaveText('Connect');
    await toggle.click();

    await expect(authenticatedPage.getByTestId('shirabe-callback-success')).toBeVisible({ timeout: 15_000 });
    await expect(authenticatedPage.getByTestId('shirabe-linked-name')).toHaveText('Linked as Lumi');
    await expect(authenticatedPage).toHaveURL(/\/link\/shirabe\/callback\/?$/);
    expect(authenticatedPage.url()).not.toContain('oauth-code');
    expect(authenticatedPage.url()).not.toContain('sealed-state');
    expect(callbackBody()).toEqual({ code: 'oauth-code', state: 'sealed-state' });
  });

  test('shows a provider denial without attempting an exchange', async ({ authenticatedPage }) => {
    const callbackUrl = new URL('/link/shirabe/callback?error=access_denied&state=sealed-state', getE2EBaseUrl());
    const methods = await mockConnectionEndpoint(authenticatedPage, {
      connection: null,
      authorizeUrl: callbackUrl.toString(),
    });
    let callbackRequests = 0;
    await authenticatedPage.route('**/v1/user/connections/shirabe/callback', async (route: Route) => {
      callbackRequests += 1;
      return route.fulfill({ status: 500, body: 'must not be called' });
    });

    const settings = new SettingsPage(authenticatedPage);
    await settings.goto();
    await settings.expectLoaded();
    await authenticatedPage.getByTestId('shirabe-connection-toggle').click();

    await expect(authenticatedPage.getByTestId('shirabe-callback-error')).toBeVisible({ timeout: 15_000 });
    await expect(authenticatedPage.getByTestId('shirabe-callback-message')).toHaveText(
      'The connection was not approved, so nothing was linked.',
    );
    expect(callbackRequests).toBe(0);
    expect(methods).toEqual(['GET', 'POST']);
  });

  test('rejects a callback with missing state before making a backend request', async ({ authenticatedPage }) => {
    let callbackRequests = 0;
    await authenticatedPage.route('**/v1/user/connections/shirabe/callback', async (route: Route) => {
      callbackRequests += 1;
      return route.fulfill({ status: 500, body: 'must not be called' });
    });

    await authenticatedPage.goto('/link/shirabe/callback?code=oauth-code');

    await expect(authenticatedPage.getByTestId('shirabe-callback-message')).toHaveText(
      'That connection could not be completed.',
    );
    expect(callbackRequests).toBe(0);
    expect(authenticatedPage.url()).toContain('oauth-code');
  });

  test('reports an invalid state or expired session without pretending it linked', async ({ authenticatedPage }) => {
    const callbackBody = await mockCallback(authenticatedPage, { status: 401 });

    await authenticatedPage.goto('/link/shirabe/callback?code=oauth-code&state=invalid-state');

    await expect(authenticatedPage.getByTestId('shirabe-callback-message')).toHaveText(
      'You are signed out here, so the connection could not be finished. Sign in and start it again from your settings.',
    );
    expect(callbackBody()).toEqual({ code: 'oauth-code', state: 'invalid-state' });
    expect(authenticatedPage.url()).toContain('invalid-state');
    await expect(authenticatedPage.getByTestId('shirabe-callback-success')).toHaveCount(0);
  });

  test('keeps a linked account when disconnect is cancelled', async ({ authenticatedPage }) => {
    let deleteRequests = 0;
    await mockConnectionEndpoint(authenticatedPage, {
      connection: linkedConnection,
      onDelete: () => {
        deleteRequests += 1;
      },
    });

    const settings = new SettingsPage(authenticatedPage);
    await settings.goto();
    await settings.expectLoaded();
    const toggle = authenticatedPage.getByTestId('shirabe-connection-toggle');
    await expect(toggle).toHaveText('Disconnect');
    await expect(authenticatedPage.getByTestId('shirabe-stack')).toContainText('JMdict');

    authenticatedPage.once('dialog', (dialog) => dialog.dismiss());
    await toggle.click();

    expect(deleteRequests).toBe(0);
    await expect(toggle).toHaveText('Disconnect');
    await expect(authenticatedPage.getByTestId('shirabe-connection-description')).toHaveText('Linked as Lumi');
  });

  test('disconnects a linked account only after confirmation', async ({ authenticatedPage }) => {
    let deleteRequests = 0;
    await mockConnectionEndpoint(authenticatedPage, {
      connection: linkedConnection,
      onDelete: () => {
        deleteRequests += 1;
      },
    });

    const settings = new SettingsPage(authenticatedPage);
    await settings.goto();
    await settings.expectLoaded();
    const toggle = authenticatedPage.getByTestId('shirabe-connection-toggle');
    await expect(toggle).toHaveText('Disconnect');

    authenticatedPage.once('dialog', (dialog) => dialog.accept());
    await toggle.click();

    await expect(toggle).toHaveText('Connect');
    await expect(authenticatedPage.getByTestId('shirabe-connection-description')).toHaveText(
      'Connect with your Shirabe account to keep using your dictionaries',
    );
    await expect(authenticatedPage.getByTestId('shirabe-stack')).toHaveCount(0);
    expect(deleteRequests).toBe(1);
  });
});
