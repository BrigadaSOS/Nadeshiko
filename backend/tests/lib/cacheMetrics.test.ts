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
 * The number that was missing during Nadeshiko#522: which cache is holding the
 * heap. `searchStats` sat at its 10,000-entry default for three days and the
 * only visible signal was old_space climbing.
 */
const exporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
let reader: PeriodicExportingMetricReader;
let cache: typeof import('@lib/cache');

beforeAll(async () => {
  reader = new PeriodicExportingMetricReader({ exporter, exportIntervalMillis: 600_000 });
  const provider = new MeterProvider({ readers: [reader] });
  metrics.disable();
  metrics.setGlobalMeterProvider(provider);

  // After the provider: the module resolves its meter when the metrics are
  // registered, and a static import that ran first would bind the no-op one.
  cache = await import('@lib/cache');
  cache.registerCacheMetrics();
});

async function pointsFor(name: string) {
  await reader.forceFlush();
  const batches = exporter.getMetrics();
  const resource = batches[batches.length - 1] as ResourceMetrics;
  for (const scope of resource.scopeMetrics) {
    const found = scope.metrics.find((metric) => metric.descriptor.name === name);
    if (found) return found.dataPoints;
  }
  return [];
}

describe('the cache-size metric contract', () => {
  it('reports entries and the cap for every namespace, by name', async () => {
    const small = cache.createCacheNamespace('testTiny', 2);
    cache.Cache.set(small, 'a', 1, 60_000);
    cache.Cache.set(small, 'b', 2, 60_000);

    const entries = await pointsFor('cache.entries');
    const caps = await pointsFor('cache.max_entries');

    const entry = entries.find((point) => point.attributes['cache.namespace'] === 'testTiny');
    const cap = caps.find((point) => point.attributes['cache.namespace'] === 'testTiny');

    expect(entry?.value).toBe(2);
    expect(cap?.value).toBe(2);
  });

  it('reports an untouched namespace as zero rather than omitting it', async () => {
    cache.createCacheNamespace('testNeverUsed', 500);

    const entries = await pointsFor('cache.entries');
    const point = entries.find((p) => p.attributes['cache.namespace'] === 'testNeverUsed');

    /**
     * A namespace that disappears from the output when it holds nothing reads
     * like a broken exporter rather than like an empty cache -- the same
     * distinction seeding exists for on the counters.
     */
    expect(point).toBeDefined();
    expect(point?.value).toBe(0);
  });

  it('follows eviction down, so a capped namespace cannot report more than its cap', async () => {
    const ns = cache.createCacheNamespace('testCapped', 3);
    for (let i = 0; i < 20; i++) cache.Cache.set(ns, `k${i}`, i, 60_000);

    const entries = await pointsFor('cache.entries');
    const point = entries.find((p) => p.attributes['cache.namespace'] === 'testCapped');

    expect(point?.value).toBe(3);
  });
});
