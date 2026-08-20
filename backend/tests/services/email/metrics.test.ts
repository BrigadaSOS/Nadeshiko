import { describe, it, expect, beforeAll } from 'vitest';
import { metrics } from '@opentelemetry/api';
import {
  MeterProvider,
  InMemoryMetricExporter,
  PeriodicExportingMetricReader,
  AggregationTemporality,
} from '@opentelemetry/sdk-metrics';
import type { ResourceMetrics } from '@opentelemetry/sdk-metrics';

/**
 * These assert on the METRIC NAMES AND ATTRIBUTE KEYS themselves, which nothing
 * else in the suite does and which no type checks.
 *
 * The failure they exist to catch is silent by construction: a renamed attribute
 * or a typo'd instrument does not break a single request, it makes the alert rule
 * in brigadasos-infra match no series -- and a rule matching nothing looks
 * exactly like a healthy service. The names below are the contract with
 * `nadeshiko-services.yml`; changing one means changing the rule in the same
 * breath.
 *
 * Prometheus renders these with dots as underscores and `_total` on counters, so
 * `email.sent` is queried as `email_sent_total` and `email.kind` as `email_kind`.
 */
const exporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
let reader: PeriodicExportingMetricReader;
let emailMetrics: typeof import('@app/services/email/metrics');

beforeAll(async () => {
  reader = new PeriodicExportingMetricReader({ exporter, exportIntervalMillis: 60_000 });
  const provider = new MeterProvider({ readers: [reader] });
  metrics.disable();
  metrics.setGlobalMeterProvider(provider);

  // Imported AFTER the provider is registered: the module resolves its meter at
  // load time, so a static import would bind to the no-op provider.
  emailMetrics = await import('@app/services/email/metrics');
});

async function collect(): Promise<ResourceMetrics> {
  await reader.forceFlush();
  const batches = exporter.getMetrics();
  return batches[batches.length - 1];
}

function findMetric(resource: ResourceMetrics, name: string) {
  for (const scope of resource.scopeMetrics) {
    const found = scope.metrics.find((metric) => metric.descriptor.name === name);
    if (found) return found;
  }
  return undefined;
}

describe('the email metric contract', () => {
  it('seeds every enumerable series at zero, so its alert rule can fire at all', async () => {
    emailMetrics.seedEmailSeries();
    const resource = await collect();

    /**
     * THE POINT OF SEEDING. A counter that has never been incremented has no
     * series, and `increase(...) > 0` over a metric with no series evaluates to
     * NO DATA rather than to false, so the rule cannot fire. Four of shirabe's
     * five email rules were inert on their first day for exactly this reason.
     */
    const sent = findMetric(resource, 'email.sent');
    expect(sent).toBeDefined();
    expect(sent?.dataPoints.length).toBeGreaterThan(0);
    expect(sent?.dataPoints.every((point) => point.value === 0)).toBe(true);

    const kinds = sent?.dataPoints.map((point) => point.attributes['email.kind']).sort();
    expect(kinds).toEqual([
      'feedback',
      'feedback-ask',
      'magic-link',
      'onboarding-day7',
      'recap',
      'unknown',
      'verify-new-email',
      'welcome',
    ]);

    const events = findMetric(resource, 'email.events');
    const eventNames = events?.dataPoints.map((point) => point.attributes['email.event']).sort();
    expect(eventNames).toEqual(['click', 'complaint', 'hard_bounce', 'open', 'soft_bounce']);

    const rejected = findMetric(resource, 'email.webhook_rejected');
    const reasons = rejected?.dataPoints.map((point) => point.attributes['email.reason']).sort();
    expect(reasons).toEqual(['no_secret', 'unauthenticated', 'unparseable']);

    const blocked = findMetric(resource, 'email.blocked');
    expect(blocked?.dataPoints[0]?.attributes['email.reason']).toBe('suppressed');
  });

  /**
   * Deliberately NOT seeded: its attribute is an error class name, which cannot
   * be enumerated before one happens. Its rule is on the
   * NadeshikoAlertRuleMatchesNothing exclusion list in brigadasos-infra instead.
   * If this ever starts being seeded, that exclusion should be removed.
   */
  it('does not seed the delivery-error series, whose label cannot be enumerated', async () => {
    const resource = await collect();
    const errors = findMetric(resource, 'email.delivery_errors');

    expect(errors === undefined || errors.dataPoints.length === 0).toBe(true);
  });

  it('counts a send under the kind it was sent as', async () => {
    emailMetrics.recordEmailSent('magic-link');
    const resource = await collect();

    const point = findMetric(resource, 'email.sent')?.dataPoints.find(
      (dataPoint) => dataPoint.attributes['email.kind'] === 'magic-link',
    );
    expect(point?.value).toBe(1);
  });

  it('counts a delivery error under error.type, the attribute recordError already uses', async () => {
    emailMetrics.recordEmailDeliveryError('SmtpAuthError');
    const resource = await collect();

    const point = findMetric(resource, 'email.delivery_errors')?.dataPoints.find(
      (dataPoint) => dataPoint.attributes['error.type'] === 'SmtpAuthError',
    );
    expect(point?.value).toBe(1);
  });

  it('counts a webhook rejection under its reason', async () => {
    emailMetrics.recordWebhookRejected('unauthenticated');
    const resource = await collect();

    const point = findMetric(resource, 'email.webhook_rejected')?.dataPoints.find(
      (dataPoint) => dataPoint.attributes['email.reason'] === 'unauthenticated',
    );
    expect(point?.value).toBe(1);
  });

  /**
   * Every cause every scrape, zeros included. A cause that vanishes from the
   * output when its last row is lifted leaves a gap in the graph that reads like
   * a scrape failure rather than like good news.
   */
  it('reports every suppression cause including the ones at zero', async () => {
    emailMetrics.registerSuppressionGauge(async () => ({ hard_bounce: 3 }));
    const resource = await collect();

    const gauge = findMetric(resource, 'email.suppressions');
    const byCause = Object.fromEntries(
      (gauge?.dataPoints ?? []).map((point) => [point.attributes['email.cause'], point.value]),
    );

    expect(byCause).toEqual({ hard_bounce: 3, complaint: 0, repeated_soft_bounce: 0, manual: 0 });
  });

  it('reports nothing rather than zeros when the table cannot be read', async () => {
    const before = await collect();
    const baseline = findMetric(before, 'email.suppressions')?.dataPoints.length ?? 0;

    emailMetrics.registerSuppressionGauge(async () => {
      throw new Error('database is down');
    });

    const resource = await collect();
    // The first callback still reports; the throwing one contributes nothing,
    // rather than claiming every cause is at zero.
    expect(findMetric(resource, 'email.suppressions')?.dataPoints.length).toBe(baseline);
  });
});
