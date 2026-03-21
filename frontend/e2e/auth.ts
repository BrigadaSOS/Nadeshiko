import { test as base } from './fixtures';
import type { APIResponse, Page } from '@playwright/test';
import { getE2EBaseUrl } from './env';

const E2E_BASE_URL = getE2EBaseUrl();
const E2E_USER_EMAIL = 'e2e-user@nadeshiko.co';
const E2E_USER_PASSWORD = process.env.E2E_USER_PASSWORD || '';
const LOCAL_E2E_LOGIN_RETRIES = 8;
const LOCAL_E2E_LOGIN_RETRY_DELAY_MS = 1_500;

function isLocalBaseUrl(baseUrl: string) {
  try {
    const { hostname } = new URL(baseUrl);
    return hostname === 'localhost' || hostname === '127.0.0.1';
  } catch {
    return false;
  }
}

function isTransientLocalServerFailure(status: number, body: string) {
  if (status < 500) return false;

  return body.includes('Restarting Nuxt') || body.includes('__NUXT_LOADING__');
}

function formatLoginFailure(status: number, body: string, attempt: number, attempts: number) {
  const attemptLabel = attempts > 1 ? ` after ${attempt}/${attempts} attempts` : '';
  const localHint = isLocalBaseUrl(E2E_BASE_URL)
    ? ' Local Nuxt server may still be rebuilding; avoid editing watched files while local E2E is running.'
    : '';

  return `E2E login failed${attemptLabel}: ${status} ${body}${localHint}`;
}

async function waitForRetryDelay(page: Page) {
  await page.waitForTimeout(LOCAL_E2E_LOGIN_RETRY_DELAY_MS);
}

export async function loginAsE2EUser(page: Page) {
  if (!E2E_USER_PASSWORD) {
    throw new Error('E2E_USER_PASSWORD env var is not set');
  }

  const attempts = isLocalBaseUrl(E2E_BASE_URL) ? LOCAL_E2E_LOGIN_RETRIES : 1;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    let response: APIResponse;

    try {
      response = await page.request.post('/v1/auth/sign-in/email', {
        headers: {
          Origin: E2E_BASE_URL,
        },
        data: {
          email: E2E_USER_EMAIL,
          password: E2E_USER_PASSWORD,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const shouldRetry = attempt < attempts && isLocalBaseUrl(E2E_BASE_URL);

      if (shouldRetry) {
        await waitForRetryDelay(page);
        continue;
      }

      throw new Error(`E2E login request failed after ${attempt}/${attempts} attempts: ${message}`);
    }

    if (response.ok()) {
      return;
    }

    const body = await response.text();
    const shouldRetry = attempt < attempts && isTransientLocalServerFailure(response.status(), body);

    if (shouldRetry) {
      await waitForRetryDelay(page);
      continue;
    }

    throw new Error(formatLoginFailure(response.status(), body, attempt, attempts));
  }
}

export const test = base.extend({
  authenticatedPage: async ({ page }, use) => {
    await loginAsE2EUser(page);
    await use(page);
  },
});

export { expect } from './fixtures';
