import { onTTFB, type Metric } from 'web-vitals';
import { getPagePath } from '~/utils/pagePath';
import { isAnalyticsEnabled, posthog } from '~/utils/posthogClient';

/**
 * Report TTFB beside PostHog's autocaptured vitals using its property names. Use plain `web-vitals`:
 * attribution adds fields this reporter must not send. Browser OTLP reporting is retired;
 * page/browser/device/connection breakdowns remain, but edge-colo enrichment does not.
 */

/**
 * Exclude webdriver, declared bots and unrecognized browser families so automation does not dominate reader
 * percentiles. Dropping rare real-browser samples is an accepted limitation of the final filter.
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
  // Run after PostHog has declared whether analytics will start.
  dependsOn: ['posthog'],
  setup() {
    // Gate on analytics startup, not SDK readiness; captures can queue while the chunk loads.
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
         * Keep bounded breakdowns only. Template page paths and omit attribution fields such as element, URL
         * and largestShiftTarget.
         */
        page_path: getPagePath(),
        client_browser_name: browserName(),
        client_device_type: deviceType(),
        client_connection_effective_type: connection?.effectiveType,
      });
    });
  },
});
