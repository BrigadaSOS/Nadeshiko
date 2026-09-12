import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { test as base } from './fixtures';
import type { APIResponse, Page } from '@playwright/test';
import { e2eAuthStatePath } from './auth-state';
import { e2eBypassHeaders, getE2EBaseUrl } from './env';

const E2E_BASE_URL = getE2EBaseUrl();
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

export interface E2EAccount {
  email: string;
  username: string;
  workerIndex: number;
}

function currentWorkerAccount(): E2EAccount {
  const parallelIndex = Number.parseInt(process.env.TEST_PARALLEL_INDEX ?? '0', 10);
  return e2eAccountForWorker(Number.isInteger(parallelIndex) && parallelIndex >= 0 ? parallelIndex : 0);
}

export function e2eAccountForWorker(workerIndex: number): E2EAccount {
  return {
    workerIndex,
    username: workerIndex === 0 ? 'e2e-user' : `e2e-user-${workerIndex}`,
    email: workerIndex === 0 ? 'e2e-user@nadeshiko.co' : `e2e-user-${workerIndex}@nadeshiko.co`,
  };
}

export async function loginAsE2EUser(page: Page, account: E2EAccount = currentWorkerAccount()) {
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
          email: account.email,
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

type WorkerFixtures = {
  e2eAccount: E2EAccount;
  workerAuthState: string;
};

export const test = base.extend<{}, WorkerFixtures>({
  e2eAccount: [
    async ({}, use, workerInfo) => {
      await use(e2eAccountForWorker(workerInfo.parallelIndex));
    },
    { scope: 'worker' },
  ],
  workerAuthState: [
    async ({ browser, e2eAccount }, use) => {
      const statePath = e2eAuthStatePath(e2eAccount.workerIndex);
      await mkdir(dirname(statePath), { recursive: true });

      const context = await browser.newContext({
        baseURL: E2E_BASE_URL,
        extraHTTPHeaders: e2eBypassHeaders(),
      });
      const page = await context.newPage();
      try {
        await loginAsE2EUser(page, e2eAccount);
        await context.storageState({ path: statePath });
      } finally {
        await context.close();
      }

      await use(statePath);
    },
    { scope: 'worker' },
  ],
  storageState: async ({ workerAuthState }, use) => {
    await use(workerAuthState);
  },
  authenticatedPage: async ({ page }, use) => {
    await use(page);
  },
});

export { expect } from './fixtures';
