import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { defineConfig, devices } from '@playwright/test';
import { e2eBypassHeaders, getE2EBaseUrl } from './env';

dotenv.config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../backend/.env') });

const BASE_URL = getE2EBaseUrl();
const JUNIT_OUTPUT = resolve(dirname(fileURLToPath(import.meta.url)), '../test-results/e2e-results.xml');

/**
 * Which Chromium to drive.
 *
 * CI keeps Google Chrome: the runner images ship it, and the release workflows
 * only `playwright install chromium` for its system deps -- so the channel is
 * what actually launches there, and pinning a real Chrome is the point (it is
 * the browser the readers use, codecs and all).
 *
 * A developer machine need not have it. Any Chromium build does the job, so
 * `E2E_BROWSER_PATH` takes an explicit binary, and failing that a Brave install
 * is picked up where Chrome is absent -- otherwise the whole suite dies at
 * launch with "Chromium distribution 'chrome' is not found", which says nothing
 * about the tests. Bundled Chromium is the last resort: it is always installed,
 * so this never leaves someone with no browser at all.
 */
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

  // No channel and no path: Playwright's own Chromium, which `npx playwright
  // install` has already put on any machine that can run this suite.
  return {};
}

const CHROMIUM = chromiumLauncher();

// Specs that need a signed-in session. The `authenticatedPage` fixture only
// hands back the page -- the session comes from this project's `storageState` --
// so a spec left off this list runs signed out and its `/v1/user/**` calls 401.
// `favorite-media` was missing and failed in `beforeEach`, before it reached a
// single assertion.
// Each name is spelled out in full: the alternation is anchored by `\.spec\.ts$`,
// so `activity` does NOT cover `activity-privacy.spec.ts`. A spec that looks
// covered but is not runs signed out and dies in `beforeEach`.
const AUTHENTICATED_TESTS =
  /(accessibility|account-lifecycle|activity|activity-privacy|admin-access|anki-deck-model|anki-field-placeholders|auth-callback|collections|developer-api-keys|favorite-media|header-navigation|hidden-categories|hidden-media|hidden-results-notice|media-filter-account|recent-searches-account|reporting|user-settings|word-mining)\.spec\.ts$/;

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
 * logic is not re-litigated here; staging runs the complete matrix against the
 * same commit with the bypass, and that is where a logic regression is caught.
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
 * ~20 production-smoke tests. Deliberately not `mobile` (viewport behaviour,
 * not infrastructure)
 * and not `redirects` (13 tests of pure routing that cannot differ by
 * environment, and the single largest consumer of the budget).
 */
const SMOKE = !!process.env.E2E_SMOKE;
// The leading `/` is load-bearing: without it `sentence` also matches
// `search/expand-sentence.spec.ts` and `navigation` matches
// `search/keyboard-navigation.spec.ts`, quietly pulling seven extra tests into
// a budget that is counted. Same trap as `isPrivatePath` in the app, and it
// fails the same silent way -- a larger run that still looks deliberate.
const SMOKE_ANONYMOUS = /\/(feeds|homepage|navigation|release-health|sentence)\.spec\.ts$/;
const SMOKE_AUTHENTICATED = /\/user-settings\.spec\.ts$/;
const CROSS_BROWSER_SMOKE = /\/(homepage|release-health|user-settings|search\/search-results)\.spec\.ts$/;
// One representative path per risk area is enough outside Chromium: SSR/CSP,
// basic interaction, Japanese result rendering and authenticated state. The
// complete behavior matrix still runs in Chromium; repeating every assertion
// in two more engines added ~30 seconds without exercising another path.
const CROSS_BROWSER_SMOKE_TITLES =
  /loads and displays core elements|hydrates with its external stylesheets|returns results for a Japanese query|displays correct username and email/;

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
  // Full staging runs use one seeded account per worker (see auth.ts and the
  // backend seeds), so stateful specs can run concurrently without clearing one
  // another's preferences, collections or activity. Four workers keeps the
  // application responsive under the state-heavy suite. Eight workers looked
  // faster in an earlier partial run, but the first complete staging gate
  // produced widespread navigation/hydration timeouts and 11 flaky tests from
  // contention, so that concurrency is beyond the staging host's safe capacity.
  // Production smoke stays serial because its HTML limiter counts bursts like
  // sustained load and intentionally has no origin bypass.
  workers: SMOKE ? 1 : 4,
  // A retry is valuable evidence, not a pass. In particular, the production
  // release gate consumes this job's conclusion, so a flaky staging test must
  // not quietly approve the release.
  failOnFlakyTests: !!process.env.CI,
  reporter: process.env.CI
    ? [
        ['html'],
        ['junit', { outputFile: JUNIT_OUTPUT }],
      ]
    : 'list',
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
      name: 'chromium-authenticated',
      testMatch: SMOKE ? SMOKE_AUTHENTICATED : AUTHENTICATED_TESTS,
      use: {
        ...devices['Desktop Chrome'],
        ...CHROMIUM,
      },
    },
    {
      name: 'chromium',
      // `testMatch` narrows in smoke; `testIgnore` still applies, which is what
      // keeps the authenticated specs from being picked up twice.
      ...(SMOKE ? { testMatch: SMOKE_ANONYMOUS } : {}),
      testIgnore: [/mobile\.spec\.ts$/, AUTHENTICATED_TESTS],
      use: {
        ...devices['Desktop Chrome'],
        ...CHROMIUM,
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
