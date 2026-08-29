import { onTTFB, type Metric } from 'web-vitals';
import { getPagePath } from '~/utils/pagePath';
import { isAnalyticsEnabled, posthog } from '~/utils/posthogClient';

/**
 * Time to First Byte, reported to PostHog.
 *
 * PostHog autocaptures the four metrics its `$web_vitals` event covers: FCP,
 * LCP, INP and CLS. TTFB is not among them and is not planned to be, because it
 * is not a Core Web Vital: it is a DIAGNOSTIC metric, one that explains LCP
 * rather than being scored itself. That is the whole reason this file still
 * exists -- everything else about this page's performance already arrives
 * without it.
 *
 * It rides the `$web_vitals` event under PostHog's own property naming
 * (`$web_vitals_TTFB_value`), so it sits beside the other four in the same
 * insight rather than in a chart of its own that nobody opens.
 *
 * THE OTLP REPORTER THAT USED TO LIVE HERE IS GONE, following shirabe's
 * `app/assets/javascripts/rum.js`, which made the same move first. It sent TTFB,
 * LCP, CLS and INP to the host Alloy as OTLP histograms, and PostHog was already
 * capturing three of those four: the page paid twice for them, and the collector
 * was single-homing only TTFB. `o.nadeshiko.co` and the Alloy on :4330 are still
 * up and still take backend telemetry; nothing on a page reaches them any more.
 * `git log -- app/plugins/rum.client.ts` has the OTLP payload builder, the
 * frozen metric names and the bucket bounds if browser metrics ever want to go
 * back.
 *
 * PLAIN `web-vitals`, NOT `web-vitals/attribution`. The attribution build is
 * roughly twice the size (11.5kB against 5.8kB unminified) and every extra field
 * it computes is one this file is forbidden to send -- `element`, `url`,
 * `largestShiftTarget` are unbounded strings. shirabe vendors the attribution
 * IIFE only because importmap has no bundler and it is one file to keep
 * diffable; there is no such constraint here, and "parity with shirabe" was the
 * stated reason for importing it, which was never a reason to ship the code.
 *
 * WHAT THAT COSTS, stated because a dashboard went dark for it: the Grafana
 * "Browser Metrics" dashboard (brigadasos-infra
 * machines/monitoring/victoria/dashboards/applications/browser-metrics.json)
 * read `web_vital_*_bucket` and now has nothing to read. Its breakdowns survive
 * here as event properties -- page, browser, device, connection -- except
 * `client_geo_edge`, the Cloudflare colo, which was server-side enrichment the
 * browser never knew and PostHog cannot derive. Country still works: PostHog
 * resolves it from the request IP itself.
 */

/**
 * WHO WOULD OTHERWISE BE MEASURED, and it is not readers. Shirabe measured this
 * on 2026-08-22: 3,446 of 3,571 LCP records in seven days -- 96% -- came from
 * one user agent, Meta's `meta-externalagent`, which executes JavaScript and
 * reports vitals exactly like a browser. Its published p75 was a
 * majority-crawler number. This site is crawled far harder than shirabe is (48k
 * bot renders per 6h against 1.6k reader renders), so the filter matters more
 * here, not less -- and it is why this file keeps one where shirabe needs none.
 *
 * Three refusals, cheapest first. "Other" is the blunt one and it is deliberate:
 * every browser with real share spells itself Chrome, Firefox, Safari or Edge,
 * Chromium forks included, so what is left is overwhelmingly automation. One
 * rare real browser losing its sample costs less than a crawler fleet setting
 * the percentile.
 *
 * This DELETES data on purpose. A low sample count here is the filter working.
 */
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

function automated(): boolean {
  if (navigator.webdriver) return true;
  if (/bot|crawler|spider|externalagent|headless/i.test(navigator.userAgent || '')) return true;
  return browserName() === 'Other';
}

export default defineNuxtPlugin({
  name: 'rum',
  // The `posthog` plugin is what starts the SDK loading, and `isAnalyticsEnabled()`
  // below is false until it has. Declared rather than left to filename order for
  // the same reason `engagedPageview` declares it: the ordering that happens to
  // work today is not a decision anybody wrote down.
  dependsOn: ['posthog'],
  setup() {
    // Not `posthog.__loaded`: the SDK is fetched asynchronously, so at plugin
    // time it has certainly not arrived. What this wants to know is whether
    // analytics exist on this build at all -- they do not outside production.
    // Everything captured before the SDK lands is queued by the snippet's stub,
    // so the gate is "will there be a client" and not "is there one yet".
    if (!isAnalyticsEnabled()) return;

    onTTFB((metric: Metric) => {
      if (automated()) return;

      const connection = (navigator as Navigator & { connection?: { effectiveType?: string } }).connection;

      posthog.capture('$web_vitals', {
        $web_vitals_TTFB_value: metric.value,
        $web_vitals_TTFB_event: {
          name: metric.name,
          value: metric.value,
          rating: metric.rating,
          navigationType: metric.navigationType,
        },
        /**
         * The breakdowns the Grafana panels used to group by, kept as
         * properties. Bounded sets only, and for the same reason they were a
         * closed list when they were Prometheus labels: `page.path` is templated
         * by `getPagePath()` because a search page carries free text and a media
         * page carries one of 242 slugs.
         *
         * No web-vitals ATTRIBUTION value belongs here either -- `element`,
         * `url`, `largestShiftTarget` are unbounded strings. PostHog would take
         * them, which is exactly why the rule has to be written down rather
         * than enforced by the sink.
         */
        page_path: getPagePath(),
        client_browser_name: browserName(),
        client_device_type: deviceType(),
        client_connection_effective_type: connection?.effectiveType,
      });
    });
  },
});
