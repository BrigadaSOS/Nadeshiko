// @vitest-environment happy-dom
import { describe, test, expect, beforeEach, vi } from 'vitest';

/**
 * TTFB, the one web vital PostHog does not autocapture.
 *
 * It is a DIAGNOSTIC metric rather than a Core Web Vital -- it explains LCP
 * rather than being scored itself -- which is why PostHog leaves it out and why
 * this file is all that is left of a reporter that used to send four.
 *
 * The part with teeth is the BOT FILTER. Shirabe measured 3,446 of 3,571 LCP
 * records in seven days -- 96% -- coming from Meta's `meta-externalagent`, which
 * executes JavaScript and reports vitals exactly like a browser; its published
 * p75 was a majority-crawler number. This site is crawled far harder (48k bot
 * renders per 6h against 1.6k reader renders), so a filter that stops working is
 * not a smaller sample, it is a number about crawlers presented as a number
 * about readers.
 */
const capture = vi.fn();
const analyticsEnabled = { value: true };
let onTTFBCallback: ((metric: unknown) => void) | null = null;

vi.mock('~/utils/posthogClient', () => ({
  posthog: { capture: (...a: unknown[]) => capture(...a) },
  isAnalyticsEnabled: () => analyticsEnabled.value,
}));
// `web-vitals`, not `web-vitals/attribution`: the plugin imports the plain
// build deliberately (see its header), and a mock left on the old path silently
// stops applying -- the real `onTTFB` then never fires under happy-dom, so every
// assertion here would pass on an event that was never sent.
vi.mock('web-vitals', () => ({
  onTTFB: (callback: (metric: unknown) => void) => {
    onTTFBCallback = callback;
  },
}));
vi.mock('~/utils/pagePath', () => ({ getPagePath: () => '/media/[slug]' }));

vi.stubGlobal('defineNuxtPlugin', (plugin: unknown) => plugin);

const CHROME =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';

/** Describes the browser this "reader" is using. */
function browser({
  userAgent = CHROME,
  webdriver = false,
  platform = 'MacIntel',
  maxTouchPoints = 0,
  // `null` means "this browser has no `navigator.connection`", NOT `undefined`:
  // a default parameter swallows `undefined` and hands back '4g', so the case
  // this exists to cover would silently test the opposite one.
  effectiveType = '4g' as string | null,
}: Partial<{
  userAgent: string;
  webdriver: boolean;
  platform: string;
  maxTouchPoints: number;
  effectiveType: string | null;
}> = {}) {
  for (const [key, value] of Object.entries({ userAgent, webdriver, platform, maxTouchPoints })) {
    Object.defineProperty(navigator, key, { value, configurable: true });
  }
  Object.defineProperty(navigator, 'connection', {
    value: effectiveType === null ? undefined : { effectiveType },
    configurable: true,
  });
}

/** Installs the plugin and delivers one TTFB reading. */
async function report(metric: Record<string, unknown> = {}) {
  const plugin = ((await import('./rum.client')) as unknown as { default: { setup: () => void } }).default;
  plugin.setup();
  onTTFBCallback?.({ name: 'TTFB', value: 812.4, rating: 'needs-improvement', navigationType: 'navigate', ...metric });
}

/** The properties of the one `$web_vitals` event, or undefined if none was sent. */
const sent = () => capture.mock.calls[0]?.[1] as Record<string, unknown> | undefined;

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  analyticsEnabled.value = true;
  onTTFBCallback = null;
  browser();
});

describe('the reading itself', () => {
  test('rides PostHog’s own `$web_vitals` event', async () => {
    // Rather than an event of our own: this way it sits beside the four PostHog
    // autocaptures in the same insight, instead of in a chart nobody opens.
    await report();

    expect(capture).toHaveBeenCalledWith('$web_vitals', expect.anything());
  });

  test('uses PostHog’s property naming, or the insight cannot read it', async () => {
    await report({ value: 812.4 });

    expect(sent()?.$web_vitals_TTFB_value).toBe(812.4);
  });

  test('carries the rating and navigation type, which say what the number means', async () => {
    // A 900ms TTFB on a back-forward restore is a different fact from 900ms on
    // a cold navigation.
    await report({ navigationType: 'back-forward-cache' });

    expect(sent()?.$web_vitals_TTFB_event).toEqual({
      name: 'TTFB',
      value: 812.4,
      rating: 'needs-improvement',
      navigationType: 'back-forward-cache',
    });
  });

  test('reports a zero reading rather than dropping it', async () => {
    // A cache hit is the fastest case, and dropping it biases every percentile
    // upward -- the same trap the CLS baseline used to guard.
    await report({ value: 0 });

    expect(sent()?.$web_vitals_TTFB_value).toBe(0);
  });
});

describe('the breakdowns the Grafana panels used to group by', () => {
  test('the page, TEMPLATED rather than raw', async () => {
    // A search page carries free text and a media page carries one of 242
    // slugs. That mattered when these were Prometheus labels and it still
    // matters: it is the difference between a breakdown and a list.
    await report();

    expect(sent()?.page_path).toBe('/media/[slug]');
  });

  test('the browser', async () => {
    await report();

    expect(sent()?.client_browser_name).toBe('Chrome');
  });

  test.each([
    ['desktop', { platform: 'MacIntel', maxTouchPoints: 0 }],
    ['tablet', { platform: 'MacIntel', maxTouchPoints: 5 }],
    ['mobile', { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Chrome/140.0 Mobile Safari/537.36' }],
  ])('the device type, here %s', async (expected, ua) => {
    // An iPad reports a desktop user agent, which is why the touch-point test
    // exists rather than a string match alone.
    browser(ua);

    await report();

    expect(sent()?.client_device_type).toBe(expected);
  });

  test('the connection type, when the browser will say', async () => {
    browser({ effectiveType: '3g' });

    await report();

    expect(sent()?.client_connection_effective_type).toBe('3g');
  });

  test('and nothing invented when it will not', async () => {
    // Safari has no `navigator.connection`; a made-up "4g" would read as a fact.
    browser({ effectiveType: null });

    await report();

    expect(sent()?.client_connection_effective_type).toBeUndefined();
  });

  test('no unbounded attribution value, whatever web-vitals attaches', async () => {
    // `element`, `url` and `largestShiftTarget` are unbounded strings. PostHog
    // would happily take them, which is exactly why the rule has to be written
    // down rather than enforced by the sink.
    await report({ attribution: { waitingDuration: 4, navigationEntry: { name: 'https://nadeshiko.co/search/だ' } } });

    expect(JSON.stringify(sent())).not.toContain('nadeshiko.co/search');
    expect(sent()).not.toHaveProperty('attribution');
  });
});

describe('traffic that is not a reader', () => {
  test.each([
    ['Meta’s crawler', 'Mozilla/5.0 (compatible; meta-externalagent/1.1)'],
    ['a headless browser', 'Mozilla/5.0 HeadlessChrome/140.0'],
    ['a self-declared bot', 'Mozilla/5.0 (compatible; Googlebot/2.1)'],
    ['a spider', 'some-spider/1.0'],
  ])('%s is not measured', async (_name, userAgent) => {
    browser({ userAgent });

    await report();

    expect(capture).not.toHaveBeenCalled();
  });

  test('an automated session is not measured, however it spells its user agent', async () => {
    browser({ webdriver: true });

    await report();

    expect(capture).not.toHaveBeenCalled();
  });

  test('and neither is anything that does not name a browser with real share', async () => {
    // The blunt refusal, and it is deliberate: every browser with real share
    // spells itself Chrome, Firefox, Safari or Edge, Chromium forks included,
    // so what is left is overwhelmingly automation. One rare real browser
    // losing its sample costs less than a crawler fleet setting the percentile.
    browser({ userAgent: 'SomeAppEmbeddedWebView/2.0' });

    await report();

    expect(capture).not.toHaveBeenCalled();
  });

  test.each([
    ['Chrome', CHROME],
    ['Firefox', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:130.0) Gecko/20100101 Firefox/130.0'],
    ['Safari', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15'],
    ['Edge', 'Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/140.0 Safari/537.36 Edg/140.0'],
  ])('but a real %s IS measured', async (expected, userAgent) => {
    browser({ userAgent });

    await report();

    expect(capture).toHaveBeenCalled();
    expect(sent()?.client_browser_name).toBe(expected);
  });
});

describe('a build with no analytics', () => {
  test('does not even subscribe, let alone report', async () => {
    // Outside production the module is not installed; everything below the gate
    // would be dead weight on every page load.
    analyticsEnabled.value = false;

    await report();

    expect(onTTFBCallback).toBeNull();
    expect(capture).not.toHaveBeenCalled();
  });
});
