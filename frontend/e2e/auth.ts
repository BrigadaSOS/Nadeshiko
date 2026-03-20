import { test as base } from './fixtures';
import type { Page } from '@playwright/test';

const E2E_BASE_URL = process.env.E2E_BASE_URL || process.env.BASE_URL || '';
const E2E_USER_EMAIL = 'e2e-user@nadeshiko.co';
const E2E_USER_PASSWORD = process.env.E2E_USER_PASSWORD || '';

export async function loginAsE2EUser(page: Page) {
  if (!E2E_USER_PASSWORD) {
    throw new Error('E2E_USER_PASSWORD env var is not set');
  }

  const response = await page.request.post('/v1/auth/sign-in/email', {
    headers: {
      Origin: E2E_BASE_URL,
    },
    data: {
      email: E2E_USER_EMAIL,
      password: E2E_USER_PASSWORD,
    },
  });

  if (!response.ok()) {
    throw new Error(`E2E login failed: ${response.status()} ${await response.text()}`);
  }
}

export const test = base.extend({
  authenticatedPage: async ({ page }, use) => {
    await loginAsE2EUser(page);
    await use(page);
  },
});

export { expect } from './fixtures';
