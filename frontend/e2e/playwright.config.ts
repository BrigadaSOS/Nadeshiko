import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { defineConfig, devices } from '@playwright/test';
import { e2eBypassHeaders, getE2EBaseUrl } from './env';

dotenv.config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../backend/.env') });

const BASE_URL = getE2EBaseUrl();
const JUNIT_OUTPUT = resolve(dirname(fileURLToPath(import.meta.url)), '../test-results/e2e-results.xml');

// Prefer real Chrome (including CI codecs); local machines may select an explicit
// E2E_BROWSER_PATH or Brave. Fall back to Playwright's installed Chromium.
const BRAVE_PATHS = [
  '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
  '/usr/bin/brave-browser',
  '/usr/bin/brave',
  'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',
];
const CHROME_PATHS = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/opt/google/chrome/chrome',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
];

function chromiumLauncher(): { channel?: string; executablePath?: string } {
  const explicit = process.env.E2E_BROWSER_PATH;
  if (explicit) return { executablePath: explicit };
  if (CHROME_PATHS.some((path) => existsSync(path))) return { channel: 'chrome' };

  const brave = BRAVE_PATHS.find((path) => existsSync(path));
  if (brave) return { executablePath: brave };

  // No channel/path selects Playwright's bundled Chromium.
  return {};
}

const CHROMIUM = chromiumLauncher();

// authenticatedPage reuses the project/worker storageState; omitted specs run signed out.
// Spell out full names: the .spec.ts anchor means "activity" does not match "activity-privacy".
const AUTHENTICATED_TESTS =
  /(accessibility|account-lifecycle|activity|activity-privacy|admin-access|anki-deck-model|anki-field-placeholders|auth-callback|collections|developer-api-keys|favorite-media|header-navigation|hidden-categories|hidden-media|hidden-results-notice|media-filter-account|recent-searches-account|reporting|shirabe-connection|user-settings|word-mining)\.spec\.ts$/;

// Release smoke stays serial and exercises deployed SSR, auth, edge/storage and database
// boundaries. Pure routing and viewport behavior do not spend the production render budget.
const SMOKE = !!process.env.E2E_SMOKE;
// Anchor the basename with / so sentence/navigation do not match expand-sentence/keyboard-navigation.
const SMOKE_ANONYMOUS = /\/(feeds|homepage|navigation|release-health|sentence)\.spec\.ts$/;
const SMOKE_AUTHENTICATED = /\/user-settings\.spec\.ts$/;
const CROSS_BROWSER_SMOKE = /\/(homepage|release-health|user-settings|search\/search-results)\.spec\.ts$/;
// Other engines cover representative SSR/CSP, interaction, Japanese rendering and auth paths;
// Chromium retains the full behavior matrix.
const CROSS_BROWSER_SMOKE_TITLES =
  /loads and displays core elements|hydrates with its external stylesheets|returns results for a Japanese query|displays correct username and email/;

export default defineConfig({
  testDir: './specs',
  globalTeardown: './global-teardown.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  // Smoke retries re-render pages against a 20-per-minute budget; limit failure cascades.
  retries: SMOKE ? 1 : process.env.CI ? 2 : 1,
  maxFailures: process.env.CI ? 5 : undefined,
  // Per-worker accounts isolate stateful specs. Four workers fit staging capacity; eight
  // caused navigation/hydration timeouts and flakes. Production smoke stays serial
  // because its HTML limiter counts bursts and intentionally has no origin bypass.
  workers: SMOKE ? 1 : 4,
  // Smoke tolerates transient edge retries; full CI fails on flakes.
  failOnFlakyTests: !!process.env.CI && !SMOKE,
  reporter: process.env.CI ? [['html'], ['junit', { outputFile: JUNIT_OUTPUT }]] : 'list',
  timeout: 60_000,

  use: {
    baseURL: BASE_URL,
    screenshot: 'only-on-failure',
    trace: 'on-first-retry',
    // Hand-built contexts must also pass these headers (e.g. anonymous collection tests).
    extraHTTPHeaders: e2eBypassHeaders(),
  },

  projects: [
    {
      name: 'chromium-authenticated',
      testMatch: SMOKE ? SMOKE_AUTHENTICATED : AUTHENTICATED_TESTS,
      use: {
        ...devices['Desktop Chrome'],
        ...CHROMIUM,
      },
    },
    {
      name: 'chromium',
      // testIgnore still applies in smoke, preventing duplicate authenticated runs.
      ...(SMOKE ? { testMatch: SMOKE_ANONYMOUS } : {}),
      testIgnore: [/mobile\.spec\.ts$/, AUTHENTICATED_TESTS],
      use: {
        ...devices['Desktop Chrome'],
        ...CHROMIUM,
      },
    },
    // Viewport behavior does not spend production's render budget.
    ...(SMOKE
      ? []
      : [
          {
            name: 'mobile',
            testMatch: /mobile\.spec\.ts$/,
            use: {
              ...devices['Desktop Chrome'],
              ...CHROMIUM,
              viewport: { width: 390, height: 844 },
              isMobile: true,
              hasTouch: true,
            },
          },
          {
            name: 'firefox-smoke',
            testMatch: CROSS_BROWSER_SMOKE,
            grep: CROSS_BROWSER_SMOKE_TITLES,
            use: devices['Desktop Firefox'],
          },
          {
            name: 'webkit-smoke',
            testMatch: CROSS_BROWSER_SMOKE,
            grep: CROSS_BROWSER_SMOKE_TITLES,
            use: devices['Desktop Safari'],
          },
        ]),
  ],
});
