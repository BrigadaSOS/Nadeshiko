import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { defineConfig, devices } from '@playwright/test';
import { e2eBypassHeaders, getE2EBaseUrl } from './env';
import { E2E_AUTH_STATE_PATH } from './auth-state';

dotenv.config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../backend/.env') });

const BASE_URL = getE2EBaseUrl();
const AUTHENTICATED_TESTS =
  /(activity|admin-reports|collections|developer-api-keys|header-navigation|hidden-media|user-settings)\.spec\.ts$/;

export default defineConfig({
  testDir: './specs',
  globalTeardown: './global-teardown.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 1,
  maxFailures: process.env.CI ? 5 : undefined,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? 'html' : 'list',
  timeout: 60_000,

  use: {
    baseURL: BASE_URL,
    screenshot: 'only-on-failure',
    trace: 'on-first-retry',
    // See `e2eBypassHeaders`. Applies to every context the projects create; a
    // context built by hand inside a test (the anonymous one in
    // collections.spec.ts) has to pass them itself.
    extraHTTPHeaders: e2eBypassHeaders(),
  },

  projects: [
    {
      name: 'setup',
      testMatch: /auth\.setup\.ts$/,
    },
    {
      name: 'chromium-authenticated',
      dependencies: ['setup'],
      testMatch: AUTHENTICATED_TESTS,
      use: {
        ...devices['Desktop Chrome'],
        channel: 'chrome',
        storageState: E2E_AUTH_STATE_PATH,
      },
    },
    {
      name: 'chromium',
      testIgnore: [/mobile\.spec\.ts$/, /auth\.setup\.ts$/, AUTHENTICATED_TESTS],
      use: {
        ...devices['Desktop Chrome'],
        channel: 'chrome',
      },
    },
    {
      name: 'mobile',
      testMatch: /mobile\.spec\.ts$/,
      use: {
        ...devices['Desktop Chrome'],
        channel: 'chrome',
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
});
