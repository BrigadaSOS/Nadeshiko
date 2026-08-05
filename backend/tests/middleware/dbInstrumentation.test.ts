import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AggregationTemporality,
  InMemoryMetricExporter,
  MeterProvider,
  PeriodicExportingMetricReader,
} from '@opentelemetry/sdk-metrics';
import type { DataPoint, ExponentialHistogram, Histogram } from '@opentelemetry/sdk-metrics';
import { InstrumentedTypeOrmLogger } from '@app/middleware/dbInstrumentation';
import { logger } from '@config/log';
import { config } from '@config/config';

const exporter = new InMemoryMetricExporter(AggregationTemporality.DELTA);
const reader = new PeriodicExportingMetricReader({ exporter, exportIntervalMillis: 2 ** 31 - 1 });
const meter = new MeterProvider({ readers: [reader] }).getMeter('test');

function createLogger(): InstrumentedTypeOrmLogger {
  return new InstrumentedTypeOrmLogger(meter);
}

/**
 * The data points recorded for one metric since the last flush.
 *
 * `metric.dataPoints` is a union of three per-value-type arrays (counter,
 * histogram, exponential histogram), and flat-mapping across the union leaves
 * TypeScript with an unusable `never`-ish element type. Naming the element type
 * once here is what lets call sites index and read `.attributes` directly.
 */
type RecordedPoint = DataPoint<number | Histogram | ExponentialHistogram>;

async function collectMetric(name: string): Promise<RecordedPoint[]> {
  await reader.forceFlush();
  return exporter
    .getMetrics()
    .flatMap((resourceMetrics) => resourceMetrics.scopeMetrics)
    .flatMap((scopeMetrics) => scopeMetrics.metrics)
    .filter((metric) => metric.descriptor.name === name)
    .flatMap((metric) => metric.dataPoints as RecordedPoint[]);
}

afterEach(async () => {
  vi.restoreAllMocks();
  // Drain the delta window so recordings do not leak into the next test.
  await reader.forceFlush();
  exporter.reset();
});

describe('InstrumentedTypeOrmLogger.logQuerySlow', () => {
  it('records the real duration in seconds on the duration histogram', async () => {
    vi.spyOn(logger, 'warn').mockImplementation(() => logger);

    createLogger().logQuerySlow(250, 'SELECT * FROM "segment" WHERE id = $1');

    const points = await collectMetric('db.postgresql.operation.duration');
    expect(points).toHaveLength(1);
    expect((points[0].value as any).sum).toBeCloseTo(0.25, 5);
    expect(points[0].attributes['db.operation.name']).toBe('SELECT');
    expect(points[0].attributes['db.collection.name']).toBe('segment');
    expect(points[0].attributes['db.system.name']).toBe('postgresql');
  });

  it('warns only once the slow-query threshold is exceeded', () => {
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => logger);
    const dbLogger = createLogger();

    dbLogger.logQuerySlow(config.DB_SLOW_QUERY_THRESHOLD_MS + 1, 'SELECT * FROM "media"');
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][1]).toBe('Slow SELECT media');

    warnSpy.mockClear();
    dbLogger.logQuerySlow(1, 'SELECT * FROM "media"');
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('still measures fast queries that stay under the warn threshold', async () => {
    vi.spyOn(logger, 'warn').mockImplementation(() => logger);

    createLogger().logQuerySlow(2, 'UPDATE "user" SET name = $1');

    const points = await collectMetric('db.postgresql.operation.duration');
    expect(points).toHaveLength(1);
    expect((points[0].value as any).sum).toBeCloseTo(0.002, 6);
    expect(points[0].attributes['db.operation.name']).toBe('UPDATE');
  });
});

describe('InstrumentedTypeOrmLogger.logQueryError', () => {
  it('counts the failure instead of recording a 0ms duration sample', async () => {
    vi.spyOn(logger, 'error').mockImplementation(() => logger);

    createLogger().logQueryError(new Error('boom'), 'INSERT INTO "segment" (id) VALUES ($1)');

    expect(await collectMetric('db.postgresql.operation.duration')).toHaveLength(0);

    const errors = await collectMetric('db.postgresql.operation.errors');
    expect(errors).toHaveLength(1);
    expect(errors[0].value).toBe(1);
    expect(errors[0].attributes['error.type']).toBe('query_error');
    expect(errors[0].attributes['db.operation.name']).toBe('INSERT');
    expect(errors[0].attributes['db.collection.name']).toBe('segment');
  });
});
