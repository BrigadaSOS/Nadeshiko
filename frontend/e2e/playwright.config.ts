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

/**
 * SMOKE MODE, set by the production release workflow. Staging keeps the whole
 * suite; production runs a subset, and the reason is a hard limit rather than a
 * preference.
 *
 * Production throttles HTML renders to `NUXT_RATE_LIMIT_HTML_MAX: 20` per minute
 * per IP, and deliberately has no bypass -- see the note in
 * frontend/config/deploy.staging.yml, where the staging-only bypass secret says
 * so explicitly. A CI run is one runner address, so all 152 tests cannot fit:
 * measured on prod, request 23 in a minute returns 429. The suite did not fail
 * honestly when it hit that. It 429d at whatever assertion happened to be next,
 * so each run blamed a different innocent test -- collections and hidden-media
 * in v2.3.1, media and redirects in v2.3.3 -- and prod E2E had been red since
 * 2026-08-10 for a reason that was never in the application.
 *
 * WHAT EARNS A SLOT: things that can only break in production. Real Postgres,
 * real Elasticsearch, real R2/CDN media, real Cloudflare in front. Application
 * logic is not re-litigated here; staging runs all 152 against the same commit
 * with the bypass, and that is where a logic regression is caught.
 *
 *   homepage      SSR renders, real stats and recent-media come back
 *   navigation    six status-code checks -- one render each, the cheapest
 *                 real-infrastructure coverage available
 *   sentence      SSR plus R2/CDN images, and the edge cache added 2026-08-13
 *   user-settings the only authenticated one: real better-auth against the real
 *                 database. This is the shape of bug (a 403 from /list-sessions
 *                 that made the panel unusable for anyone logged in over a day)
 *                 that staging can miss and prod cannot afford to.
 *
 * ~20 tests. Deliberately not `mobile` (viewport behaviour, not infrastructure)
 * and not `redirects` (13 tests of pure routing that cannot differ by
 * environment, and the single largest consumer of the budget).
 */
const SMOKE = !!process.env.E2E_SMOKE;
// The leading `/` is load-bearing: without it `sentence` also matches
// `search/expand-sentence.spec.ts` and `navigation` matches
// `search/keyboard-navigation.spec.ts`, quietly pulling seven extra tests into
// a budget that is counted. Same trap as `isPrivatePath` in the app, and it
// fails the same silent way -- a larger run that still looks deliberate.
const SMOKE_ANONYMOUS = /\/(homepage|navigation|sentence)\.spec\.ts$/;
const SMOKE_AUTHENTICATED = /\/user-settings\.spec\.ts$/;

export default defineConfig({
  testDir: './specs',
  globalTeardown: './global-teardown.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  // One retry in smoke, not two. A retry re-renders every page the test touched,
  // so against a 20-per-minute budget the retries are what turn one real failure
  // into a cascade of unrelated ones.
  retries: SMOKE ? 1 : process.env.CI ? 2 : 1,
  maxFailures: process.env.CI ? 5 : undefined,
  // Serial in smoke for the same reason: two workers burst, and the limiter
  // counts a burst the same as sustained load.
  workers: SMOKE ? 1 : process.env.CI ? 2 : undefined,
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
      testMatch: SMOKE ? SMOKE_AUTHENTICATED : AUTHENTICATED_TESTS,
      use: {
        ...devices['Desktop Chrome'],
        channel: 'chrome',
        storageState: E2E_AUTH_STATE_PATH,
      },
    },
    {
      name: 'chromium',
      // `testMatch` narrows in smoke; `testIgnore` still applies, which is what
      // keeps the authenticated specs from being picked up twice.
      ...(SMOKE ? { testMatch: SMOKE_ANONYMOUS } : {}),
      testIgnore: [/mobile\.spec\.ts$/, /auth\.setup\.ts$/, AUTHENTICATED_TESTS],
      use: {
        ...devices['Desktop Chrome'],
        channel: 'chrome',
      },
    },
    // Mobile is viewport behaviour, which cannot differ between staging and
    // production, so it does not spend production's budget.
    ...(SMOKE
      ? []
      : [
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
        ]),
  ],
});
