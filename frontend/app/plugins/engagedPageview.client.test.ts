// @vitest-environment happy-dom
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';

import { ENGAGED_VIEW_DWELL_MS } from '~/utils/engagedView';

/**
 * `page_engaged`: the event that separates readers from scrapers.
 *
 * Built after the homepage took 686 full renders from three Azure addresses
 * running headless Chrome in a day, which PostHog counted as ~800 separate
 * people -- each render is a fresh browser profile, so each gets its own
 * anonymous device id. Nothing flagged it: `isLikelyBot` sees a valid Chrome
 * user-agent and passes it through, and PostHog's own classification put all 30
 * days in `Regular` bar sixteen pageviews.
 *
 * Dwell is the one signal that separates the two populations without an
 * allow-list anyone has to maintain: a scraper is gone within a load. So what
 * matters here is exactly WHEN the clock runs -- foreground only, once per page,
 * and not restarted by the query-string churn of a search.
 *
 * It is additive: `$pageview` still fires on every load, and the GAP between the
 * two is the scraping metric. Dropping at capture would throw away the only
 * number that shows the problem exists.
 */
const capture = vi.fn();
const analyticsEnabled = { value: true };
vi.mock('~/utils/posthogClient', () => ({
  posthog: { capture: (...a: unknown[]) => capture(...a) },
  isAnalyticsEnabled: () => analyticsEnabled.value,
}));

let afterEachGuard: ((to: { path: string }) => void) | null = null;
const currentRoute = { value: { path: '/en/search/kanji' } };
vi.stubGlobal('defineNuxtPlugin', (plugin: unknown) => plugin);
vi.stubGlobal('useRouter', () => ({
  currentRoute,
  afterEach: (fn: (to: { path: string }) => void) => {
    afterEachGuard = fn;
  },
}));

/**
 * Installs the plugin as Nuxt would, holding on to the visibility listener it
 * registers.
 *
 * Kept rather than dispatched at, because the plugin deliberately never removes
 * that listener -- it is meant to live as long as the document -- so a real
 * `visibilitychange` event reaches every instance installed by every earlier
 * test in this file, and they all report their own page.
 */
let onVisibilityChange: (() => void) | null = null;

async function install() {
  const listeners = vi.spyOn(document, 'addEventListener');
  const plugin = (
    (await import('./engagedPageview.client')) as unknown as {
      default: { setup: () => void };
    }
  ).default;
  plugin.setup();
  onVisibilityChange =
    (listeners.mock.calls.find(([type]) => type === 'visibilitychange')?.[1] as (() => void) | undefined) ?? null;
  listeners.mockRestore();
}

/** Puts the tab in the background or brings it forward, as the browser would. */
function setVisibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
  onVisibilityChange?.();
}

/** A route change the router would report. */
const navigateTo = (path: string) => afterEachGuard?.({ path });

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-08-31T12:00:00Z'));
  vi.resetModules();
  analyticsEnabled.value = true;
  afterEachGuard = null;
  onVisibilityChange = null;
  currentRoute.value = { path: '/en/search/kanji' };
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('a page that holds someone’s attention', () => {
  test('is reported once the dwell has passed', async () => {
    await install();

    vi.advanceTimersByTime(ENGAGED_VIEW_DWELL_MS);

    expect(capture).toHaveBeenCalledWith('page_engaged');
  });

  test('is not reported before then, which is where a scraper has already gone', async () => {
    await install();

    vi.advanceTimersByTime(ENGAGED_VIEW_DWELL_MS - 1);

    expect(capture).not.toHaveBeenCalled();
  });

  test('is reported once, however long the reader stays', async () => {
    await install();

    vi.advanceTimersByTime(ENGAGED_VIEW_DWELL_MS * 10);

    expect(capture).toHaveBeenCalledTimes(1);
  });

  test('is not reported a SECOND time when the reader comes back to the tab', async () => {
    // The claim, not the timer, is the authority: it re-checks accumulated
    // foreground time and answers at most once per page. Every path that
    // re-arms -- a tab regaining focus, a timer that ran long under background
    // throttling -- runs `fire` again, and only the claim stops those from
    // reporting the same page twice.
    await install();
    vi.advanceTimersByTime(ENGAGED_VIEW_DWELL_MS);
    expect(capture).toHaveBeenCalledTimes(1);

    setVisibility('hidden');
    vi.advanceTimersByTime(60_000);
    setVisibility('visible');
    vi.advanceTimersByTime(ENGAGED_VIEW_DWELL_MS);

    expect(capture).toHaveBeenCalledTimes(1);
  });

  test('carries no properties of its own, since posthog-js stamps the URL', async () => {
    await install();

    vi.advanceTimersByTime(ENGAGED_VIEW_DWELL_MS);

    expect(capture).toHaveBeenCalledWith('page_engaged');
    expect(capture.mock.calls[0]).toHaveLength(1);
  });
});

describe('moving between pages', () => {
  test('a new page starts its own clock', async () => {
    await install();
    vi.advanceTimersByTime(ENGAGED_VIEW_DWELL_MS);
    capture.mockClear();

    navigateTo('/en/media');
    vi.advanceTimersByTime(ENGAGED_VIEW_DWELL_MS);

    expect(capture).toHaveBeenCalledTimes(1);
  });

  test('leaving early means the page is never reported', async () => {
    await install();

    vi.advanceTimersByTime(ENGAGED_VIEW_DWELL_MS - 500);
    navigateTo('/en/media');
    vi.advanceTimersByTime(400);

    expect(capture).not.toHaveBeenCalled();
  });

  test('the query churn of a search does NOT restart the clock', async () => {
    // A reader sitting on one set of results, narrowing it, is still reading the
    // same page -- restarting on every filter click would mean a busy reader is
    // never counted.
    await install();
    vi.advanceTimersByTime(ENGAGED_VIEW_DWELL_MS - 500);

    navigateTo('/en/search/kanji');
    vi.advanceTimersByTime(500);

    expect(capture).toHaveBeenCalledTimes(1);
  });

  test('and the route the router re-reports on hydration is a no-op, not a rewind', async () => {
    await install();
    vi.advanceTimersByTime(1000);
    navigateTo('/en/search/kanji');

    vi.advanceTimersByTime(ENGAGED_VIEW_DWELL_MS - 1000);

    expect(capture).toHaveBeenCalledTimes(1);
  });
});

describe('a tab nobody is looking at', () => {
  test('a page opened in the background is not counted while it sits there', async () => {
    // It is counted when it is read and never before.
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    await install();

    vi.advanceTimersByTime(ENGAGED_VIEW_DWELL_MS * 3);

    expect(capture).not.toHaveBeenCalled();
  });

  test('and is counted once it is brought forward', async () => {
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    await install();
    vi.advanceTimersByTime(ENGAGED_VIEW_DWELL_MS * 3);

    setVisibility('visible');
    vi.advanceTimersByTime(ENGAGED_VIEW_DWELL_MS);

    expect(capture).toHaveBeenCalledTimes(1);
  });

  test('time spent hidden does not count towards the dwell', async () => {
    await install();
    vi.advanceTimersByTime(1000);

    setVisibility('hidden');
    vi.advanceTimersByTime(ENGAGED_VIEW_DWELL_MS * 5);

    expect(capture).not.toHaveBeenCalled();
  });

  test('but foreground time accumulates across a visit to another tab', async () => {
    // Someone who reads, checks their mail and comes back has read the page.
    await install();
    vi.advanceTimersByTime(ENGAGED_VIEW_DWELL_MS - 500);
    setVisibility('hidden');
    vi.advanceTimersByTime(60_000);

    setVisibility('visible');
    vi.advanceTimersByTime(500);

    expect(capture).toHaveBeenCalledTimes(1);
  });
});

describe('a build with no analytics', () => {
  test('installs nothing at all', async () => {
    // Outside production the module is not installed, and everything below the
    // gate would be dead weight on every page load.
    analyticsEnabled.value = false;
    await install();

    vi.advanceTimersByTime(ENGAGED_VIEW_DWELL_MS * 5);

    expect(capture).not.toHaveBeenCalled();
    expect(afterEachGuard).toBeNull();
  });
});
