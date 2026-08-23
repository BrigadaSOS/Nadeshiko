import { onCLS, onINP, onLCP, onTTFB, type Metric } from 'web-vitals/attribution';
import { getPagePath } from '~/utils/pagePath';

/**
 * Core Web Vitals as OTLP histograms, posted to the host Alloy's browser-metrics
 * receiver (o.nadeshiko.co/v1/metrics -> :4330, see brigadasos-infra
 * ansible/roles/host_alloy/files/config-nadeshiko.alloy).
 *
 * THIS IS WHAT SURVIVES FARO. The Web SDK collected vitals too, and that is
 * exactly what hid the problem: Faro ships them as MEASUREMENT EVENTS, which the
 * Faro receiver turns into LOGS. The `browser-metrics` dashboard queries
 * `web_vital_*_bucket`, a metric family, so it has never had anything to read on
 * this host. PostHog does not close the gap either -- its `$web_vitals` carries
 * LCP, INP, CLS and FCP and has no TTFB at all (verified over 7 days on
 * 2026-08-23: 3,840 / 5,143 / 2,212 / 6,571 and zero). TTFB is the one number
 * that matters most for a European origin serving readers in Japan, so it is the
 * one thing that had to be rebuilt rather than dropped.
 *
 * Ported from lostcoords' shirabe app/assets/javascripts/rum.js, deliberately
 * keeping its metric names, bucket bounds and label set so one Grafana dashboard
 * reads both estates identically. THE NAMES AND BOUNDS ARE FROZEN: renaming
 * either silently blanks a live panel.
 *
 * `web-vitals` is an npm dependency pinned to 5.2.0 rather than a vendored IIFE
 * (shirabe vendors the file because importmap has no bundler). Same guarantee --
 * nothing is fetched from a CDN at runtime -- with the version recorded in
 * package-lock.json instead of a comment. The attribution build is imported for
 * parity with shirabe; nothing here reads its extra fields yet, and nothing may
 * start without reading the cardinality note on `dataPoints` below.
 */

const HISTOGRAMS: Record<string, { name: string; description: string; scale?: number; bounds: number[] }> = {
  TTFB: {
    name: 'web_vital.ttfb',
    description: 'Time to First Byte',
    bounds: [0, 100, 200, 400, 800, 1200, 1800, 3000, 5000],
  },
  LCP: {
    name: 'web_vital.lcp',
    description: 'Largest Contentful Paint',
    bounds: [0, 200, 500, 1000, 2500, 4000, 6000, 10000],
  },
  // CLS is unitless (a layout-shift score, typically 0.0-0.5) and is scaled by
  // 1000 so it can share the millisecond histogram machinery. Divide by 1000
  // when reading it.
  CLS: {
    name: 'web_vital.cls',
    description: 'Cumulative Layout Shift',
    scale: 1000,
    bounds: [0, 50, 100, 250, 500, 1000],
  },
  INP: {
    name: 'web_vital.inp',
    description: 'Interaction to Next Paint',
    bounds: [0, 50, 100, 200, 300, 500, 1000, 2000],
  },
};

type OtlpAttribute = { key: string; value: { stringValue: string } };

function attribute(key: string, value: string | undefined | null): OtlpAttribute | null {
  if (value === undefined || value === null || value === '') return null;
  return { key, value: { stringValue: String(value) } };
}

function compact(attributes: (OtlpAttribute | null)[]): OtlpAttribute[] {
  return attributes.filter((a): a is OtlpAttribute => a !== null);
}

function bucketCounts(value: number, bounds: number[]): string[] {
  const counts = new Array(bounds.length + 1).fill(0);
  const index = bounds.findIndex((bound) => value <= bound);
  counts[index === -1 ? bounds.length : index] = 1;
  return counts.map(String);
}

function browserName(): string {
  const ua = navigator.userAgent || '';
  if (/Edg\//.test(ua)) return 'Edge';
  if (/Firefox\//.test(ua)) return 'Firefox';
  if (/Chrome\//.test(ua) || /CriOS\//.test(ua)) return 'Chrome';
  if (/Safari\//.test(ua)) return 'Safari';
  return 'Other';
}

function deviceType(): string {
  const ua = navigator.userAgent || '';
  if (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1) return 'tablet';
  if (/iPad|Tablet|PlayBook|Silk/.test(ua)) return 'tablet';
  if (/Mobi|Android|iPhone|iPod/.test(ua)) return 'mobile';
  return 'desktop';
}

/**
 * WHO WOULD OTHERWISE BE MEASURED, and it is not readers. Shirabe measured this
 * on 2026-08-22: 3,446 of 3,571 LCP records in seven days -- 96% -- came from
 * one user agent, Meta's `meta-externalagent`, which executes JavaScript and
 * reports vitals exactly like a browser. Its published p75 was a
 * majority-crawler number. This site is crawled far harder than shirabe is (48k
 * bot renders per 6h against 1.6k reader renders), so the same filter matters
 * more here, not less.
 *
 * Three refusals, cheapest first. "Other" is the blunt one and it is deliberate:
 * every browser with real share spells itself Chrome, Firefox, Safari or Edge,
 * Chromium forks included, so what is left is overwhelmingly automation. One
 * rare real browser losing its sample costs less than a crawler fleet setting
 * the percentile.
 *
 * This DELETES data on purpose. A low sample count here is the filter working.
 */
function automated(): boolean {
  if (navigator.webdriver) return true;
  if (/bot|crawler|spider|externalagent|headless/i.test(navigator.userAgent || '')) return true;
  return browserName() === 'Other';
}

function send(metricsUrl: string, appName: string, environment: string, metric: Metric): void {
  const histogram = HISTOGRAMS[metric.name];
  if (!histogram || automated()) return;
  if (!navigator.sendBeacon && !window.fetch) return;

  const now = String(Date.now() * 1_000_000);
  const value = metric.value * (histogram.scale || 1);
  const connection = (navigator as Navigator & { connection?: { effectiveType?: string } }).connection;

  const payload = {
    resourceMetrics: [
      {
        resource: {
          attributes: compact([
            attribute('service.name', appName),
            attribute('deployment.environment', environment),
            attribute('telemetry.sdk.name', 'nadeshiko-browser-vitals'),
          ]),
        },
        scopeMetrics: [
          {
            scope: { name: appName },
            metrics: [
              {
                name: histogram.name,
                description: histogram.description,
                unit: 'ms',
                histogram: {
                  aggregationTemporality: 1,
                  dataPoints: [
                    {
                      /**
                       * EVERY ATTRIBUTE HERE IS A PROMETHEUS LABEL, one new
                       * series per distinct value, per vital, per bucket. The
                       * list is closed. Nothing joins it without a panel that
                       * needs it, and nothing joins it that is not a small
                       * closed set of values.
                       *
                       * In particular NO web-vitals ATTRIBUTION VALUE may be
                       * added: `element`, `url`, `largestShiftTarget` and
                       * `interactionTarget` are unbounded strings. Attribution
                       * belongs in a log line or its own histogram keyed by a
                       * bounded `part` label.
                       *
                       * `page.path` is templated by `getPagePath()` for the same
                       * reason -- a search page carries free text, and a media
                       * page carries one of 242 slugs.
                       */
                      attributes: compact([
                        attribute('vital.name', metric.name),
                        attribute('vital.rating', metric.rating),
                        attribute('page.path', getPagePath()),
                        attribute('client_browser_name', browserName()),
                        attribute('client_device_type', deviceType()),
                        attribute('client_connection_effective_type', connection?.effectiveType),
                      ]),
                      startTimeUnixNano: now,
                      timeUnixNano: now,
                      count: '1',
                      sum: value,
                      bucketCounts: bucketCounts(value, histogram.bounds),
                      explicitBounds: histogram.bounds,
                    },
                  ],
                },
              },
            ],
          },
        ],
      },
    ],
  };

  const body = JSON.stringify(payload);

  // sendBeacon survives the page going away, which matters because CLS and INP
  // are only final at unload. It returns false when the payload is over the
  // browser's queue limit, hence the fetch fallback.
  if (navigator.sendBeacon) {
    const sent = navigator.sendBeacon(metricsUrl, new Blob([body], { type: 'application/json' }));
    if (sent) return;
  }

  fetch(metricsUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    keepalive: true,
  }).catch(() => {});
}

export default defineNuxtPlugin({
  name: 'rum',
  setup() {
    const config = useRuntimeConfig();
    const metricsUrl = String(config.public.browserMetricsUrl || '');
    const environment = String(config.public.environment || 'production');
    const appName =
      String(config.public.browserAppName || '') ||
      (environment === 'development' ? 'nadeshiko-frontend-browser-stg' : 'nadeshiko-frontend-browser-prod');

    // Unset outside production and staging, which is what keeps a local run from
    // posting to the collector at all.
    if (!metricsUrl) return;

    const report = (metric: Metric) => send(metricsUrl, appName, environment, metric);

    /**
     * CLS ONLY FIRES IF THE LAYOUT ACTUALLY SHIFTED. A page that never shifts
     * reports nothing, which is indistinguishable from a page that never loaded,
     * so a perfect score would silently lower the sample count and bias every
     * CLS percentile upward. Emit an explicit 0 when the real callback never came.
     */
    let clsReported = false;
    let clsBaselineReported = false;

    const reportClsBaseline = () => {
      if (clsReported || clsBaselineReported) return;
      clsBaselineReported = true;
      report({ name: 'CLS', value: 0, rating: 'good' } as Metric);
    };

    onTTFB(report);
    onLCP(report);
    onCLS((metric) => {
      clsReported = true;
      report(metric);
    });
    onINP(report);

    setTimeout(reportClsBaseline, 10_000);
    window.addEventListener('pagehide', reportClsBaseline, { once: true });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') reportClsBaseline();
    });
  },
});
