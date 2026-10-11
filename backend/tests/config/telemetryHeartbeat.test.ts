import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { metrics } from '@opentelemetry/api';
import {
  MeterProvider,
  InMemoryMetricExporter,
  PeriodicExportingMetricReader,
  AggregationTemporality,
} from '@opentelemetry/sdk-metrics';
import type { ResourceMetrics } from '@opentelemetry/sdk-metrics';
import type { Server } from 'node:http';
import { request } from '../helpers/http';
import { config } from '@config/config';

/** Use DELTA, not the cumulative reader: cumulative temporality re-reports every series and would let the tests pass
 * without detecting the production failure. */
const exporter = new InMemoryMetricExporter(AggregationTemporality.DELTA);
let reader: PeriodicExportingMetricReader;
let telemetry: typeof import('@config/telemetry');
let rateLimit: typeof import('@app/middleware/rateLimit');
let buildApplication: typeof import('@config/application').buildApplication;

beforeAll(async () => {
  reader = new PeriodicExportingMetricReader({ exporter, exportIntervalMillis: 600_000 });
  const provider = new MeterProvider({ readers: [reader] });
  metrics.disable();
  metrics.setGlobalMeterProvider(provider);

  // Imported AFTER the provider is registered: both modules resolve their meter
  // at load time, so a static import would bind to the no-op provider.
  telemetry = await import('@config/telemetry');
  rateLimit = await import('@app/middleware/rateLimit');
  ({ buildApplication } = await import('@config/application'));
});

afterEach(() => {
  vi.useRealTimers();
});

async function collect(): Promise<ResourceMetrics | undefined> {
  exporter.reset();
  await reader.forceFlush();
  const batches = exporter.getMetrics();
  return batches[batches.length - 1];
}

function pointsFor(resource: ResourceMetrics | undefined, name: string) {
  for (const scope of resource?.scopeMetrics ?? []) {
    const found = scope.metrics.find((metric) => metric.descriptor.name === name);
    if (found) return found.dataPoints;
  }
  return [];
}

describe('the zero-series heartbeat', () => {
  it('emits once immediately, so the caller does not also have to seed', async () => {
    const emitter = vi.fn();
    const stop = telemetry.startSeriesHeartbeat([emitter], 60_000);

    expect(emitter).toHaveBeenCalledTimes(1);
    stop();
  });

  it('re-emits on the interval, which is what one seeding at boot does not do', () => {
    vi.useFakeTimers();
    const emitter = vi.fn();
    const stop = telemetry.startSeriesHeartbeat([emitter], 60_000);

    vi.advanceTimersByTime(180_000);
    expect(emitter).toHaveBeenCalledTimes(4);

    stop();
    vi.advanceTimersByTime(180_000);
    expect(emitter).toHaveBeenCalledTimes(4);
  });

  it('keeps a delta counter producing samples after the boot export has gone', async () => {
    /** Under delta temporality, a counter recorded once disappears from later exports. Use real timers because
     * `forceFlush()` races the internal timeout under fake timers. */
    const stop = telemetry.startSeriesHeartbeat([rateLimit.seedRateLimitSeries], 25);
    await collect(); // drains the immediate emit, leaving only the interval's work

    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(pointsFor(await collect(), 'http.server.rate_limited')).not.toHaveLength(0);

    stop();
    await collect(); // drains anything the last tick recorded before it stopped

    // No counter samples arrived after the last tick, so the series should report no samples.
    expect(pointsFor(await collect(), 'http.server.rate_limited')).toHaveLength(0);
  });
});

describe('the rate-limit metric contract', () => {
  it('seeds every scope x source series at zero, including the internal ones nothing has written', async () => {
    /** The `source="internal"` and `http_server_rate_limited_total` labels are the contract with the production
     * alert rule; changing them requires changing that rule too. */
    rateLimit.seedRateLimitSeries();
    const points = pointsFor(await collect(), 'http.server.rate_limited');

    expect(points).toHaveLength(rateLimit.RATE_LIMIT_SCOPES.length * 2);
    expect(points.every((point) => point.value === 0)).toBe(true);

    const sources = new Set(points.map((point) => point.attributes.source));
    expect([...sources].sort()).toEqual(['external', 'internal']);

    const internalScopes = points
      .filter((point) => point.attributes.source === 'internal')
      .map((point) => point.attributes.scope)
      .sort();
    expect(internalScopes).toEqual([...rateLimit.RATE_LIMIT_SCOPES].sort());
  });

  it('records the exact IPv6 /56 limiter key for operator-only triage', async () => {
    const app = buildApplication({
      mountRoutes: (application) => {
        application.get('/metric-rate-limit-probe', (_req, res) => res.json({ ok: true }));
      },
    });
    const server: Server = app.listen(0);

    try {
      const max = config.RATE_LIMIT_MAX_REQUESTS_PER_IP;
      for (let i = 0; i <= max; i += 1) {
        await request(server).get('/metric-rate-limit-probe').set('CF-Connecting-IP', '2001:db8:abcd:12ff::2');
      }

      const points = pointsFor(await collect(), 'http.server.rate_limited');
      const rejected = points.find(
        (point) =>
          point.attributes.scope === 'global' &&
          point.attributes.source === 'external' &&
          point.attributes.client_ip === '2001:db8:abcd:1200::/56',
      );

      expect(rejected?.value).toBeGreaterThan(0);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }, 20_000);
});
