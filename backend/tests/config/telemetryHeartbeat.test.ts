import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { metrics } from '@opentelemetry/api';
import {
  MeterProvider,
  InMemoryMetricExporter,
  PeriodicExportingMetricReader,
  AggregationTemporality,
} from '@opentelemetry/sdk-metrics';
import type { ResourceMetrics } from '@opentelemetry/sdk-metrics';

/**
 * The regression these cover is invisible from inside the process: the seeding
 * works, the series exists, and the alert rule that reads it still matches
 * nothing an hour later.
 *
 * DELTA IS THE WHOLE POINT, so the reader below is DELTA and not the CUMULATIVE
 * one the email contract test uses. A cumulative reader re-reports every series
 * on every collection, which is precisely the behaviour production does NOT
 * have -- write these against a cumulative reader and they pass without testing
 * anything.
 */
const exporter = new InMemoryMetricExporter(AggregationTemporality.DELTA);
let reader: PeriodicExportingMetricReader;
let telemetry: typeof import('@config/telemetry');
let rateLimit: typeof import('@app/middleware/rateLimit');

beforeAll(async () => {
  reader = new PeriodicExportingMetricReader({ exporter, exportIntervalMillis: 600_000 });
  const provider = new MeterProvider({ readers: [reader] });
  metrics.disable();
  metrics.setGlobalMeterProvider(provider);

  // Imported AFTER the provider is registered: both modules resolve their meter
  // at load time, so a static import would bind to the no-op provider.
  telemetry = await import('@config/telemetry');
  rateLimit = await import('@app/middleware/rateLimit');
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
    /**
     * THE ACTUAL BUG, reproduced. Under delta temporality an export carries only
     * the attribute sets that recorded a measurement since the last collection,
     * so a counter seeded once is present in the first export and absent from
     * every one after it -- which is what left the two email webhook rules
     * matching nothing an hour after each deploy.
     *
     * REAL TIMERS, deliberately: `reader.forceFlush()` races an internal timeout,
     * so awaiting a collection under fake timers never resolves. The interval is
     * 25ms instead, which is the same mechanism at a speed a test can wait for.
     */
    const stop = telemetry.startSeriesHeartbeat([rateLimit.seedRateLimitSeries], 25);
    await collect(); // drains the immediate emit, leaving only the interval's work

    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(pointsFor(await collect(), 'http.server.rate_limited')).not.toHaveLength(0);

    stop();
    await collect(); // drains anything the last tick recorded before it stopped

    // Nothing has touched the counter since, and this is exactly what production
    // looked like an hour after every deploy: the series exists, and it reports
    // no samples at all.
    expect(pointsFor(await collect(), 'http.server.rate_limited')).toHaveLength(0);
  });
});

describe('the rate-limit metric contract', () => {
  it('seeds every scope x source series at zero, including the internal ones nothing has written', async () => {
    /**
     * `source="internal"` is written the first time the backend throttles one of
     * its own callers -- the thing NadeshikoBackendProdRateLimitingItself exists
     * to catch, and therefore the thing that has never happened. Unseeded, that
     * rule reads NO DATA rather than false and reports healthy forever.
     *
     * Prometheus renders these as `http_server_rate_limited_total`, with `scope`
     * and `source` as labels: the names are the contract with
     * nadeshiko-services.yml in brigadasos-infra, so changing one means changing
     * the rule in the same breath.
     */
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
});
