import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * The OTLP wiring, which is all module-level and gated on one environment
 * variable.
 *
 * Most of this file is "construct the SDK", which is not worth asserting. Two
 * things are:
 *
 * - It stays INERT without an endpoint. That is the state every developer
 *   machine and every test run is in, so a version bump that made construction
 *   unconditional would try to export to nowhere on every process start.
 * - `shutdownTelemetry` shuts down BOTH providers and resolves either way. It
 *   is awaited on the SIGTERM path and again inside the fatal handler, so a
 *   rejection there turns a clean exit into a hang, and shutting down only the
 *   tracer silently drops the last metrics batch of every deploy.
 */
const tracerShutdown = vi.fn().mockResolvedValue(undefined);
const meterShutdown = vi.fn().mockResolvedValue(undefined);
const registerTracer = vi.fn();
const setGlobalMeterProvider = vi.fn();
const registerInstrumentations = vi.fn();

vi.mock('@opentelemetry/sdk-trace-node', () => ({
  NodeTracerProvider: class {
    register = registerTracer;
    shutdown = tracerShutdown;
  },
  BatchSpanProcessor: class {},
}));

vi.mock('@opentelemetry/sdk-metrics', () => ({
  MeterProvider: class {
    shutdown = meterShutdown;
  },
  PeriodicExportingMetricReader: class {},
}));

vi.mock('@opentelemetry/exporter-trace-otlp-http', () => ({ OTLPTraceExporter: class {} }));
vi.mock('@opentelemetry/exporter-metrics-otlp-http', () => ({
  OTLPMetricExporter: class {},
  AggregationTemporalityPreference: { DELTA: 'DELTA' },
}));
vi.mock('@opentelemetry/instrumentation', () => ({
  registerInstrumentations: (...a: unknown[]) => registerInstrumentations(...a),
}));
vi.mock('@opentelemetry/instrumentation-pino', () => ({ PinoInstrumentation: class {} }));
vi.mock('@opentelemetry/instrumentation-undici', () => ({ UndiciInstrumentation: class {} }));
vi.mock('@opentelemetry/instrumentation-runtime-node', () => ({ RuntimeNodeInstrumentation: class {} }));
vi.mock('@opentelemetry/resources', () => ({ resourceFromAttributes: (attrs: unknown) => attrs }));

// `@opentelemetry/api` is deliberately NOT mocked: `getMeter`/`getTracer` are
// meant to hand back the API's own no-op implementations when no provider is
// registered, and replacing the module would assert that against a double
// instead of against the behaviour the bot actually gets. Only the one setter
// this module calls is spied on, and it is installed before the dynamic import
// below because the call happens at module evaluation.
import { metrics } from '@opentelemetry/api';

/** Loads the module with `OTEL_EXPORTER_OTLP_ENDPOINT` set or unset. */
async function loadTelemetry(endpoint?: string) {
  vi.resetModules();
  vi.clearAllMocks();
  vi.spyOn(metrics, 'setGlobalMeterProvider').mockImplementation(setGlobalMeterProvider);
  vi.stubEnv('OTEL_EXPORTER_OTLP_ENDPOINT', endpoint ?? '');
  return import('../../telemetry');
}

beforeEach(() => {
  tracerShutdown.mockResolvedValue(undefined);
  meterShutdown.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('without an endpoint configured', () => {
  test('registers no providers at all', async () => {
    // The state every developer machine and every test run is in. Exporting to
    // nowhere on each process start is the cost of getting this wrong.
    await loadTelemetry();

    expect(registerTracer).not.toHaveBeenCalled();
    expect(setGlobalMeterProvider).not.toHaveBeenCalled();
    expect(registerInstrumentations).not.toHaveBeenCalled();
  });

  test('still hands out a usable meter and tracer', async () => {
    // Every module reaches for these at import time. Returning undefined would
    // make the whole bot fail to load rather than merely not export.
    const telemetry = await loadTelemetry();

    expect(telemetry.getMeter().createCounter('x')).toBeDefined();
    expect(telemetry.getTracer()).toBeDefined();
  });

  test('shutdown resolves rather than throwing on nothing', async () => {
    // Awaited on the SIGTERM path and again inside the fatal handler; a
    // rejection here turns a clean exit into a crash on the way out.
    const telemetry = await loadTelemetry();

    await expect(telemetry.shutdownTelemetry()).resolves.toBeUndefined();
  });
});

describe('with an endpoint configured', () => {
  test('registers the tracer and the meter providers', async () => {
    await loadTelemetry('http://otel.test:4318');

    expect(registerTracer).toHaveBeenCalled();
    expect(setGlobalMeterProvider).toHaveBeenCalled();
  });

  test('installs the instrumentations against those providers', async () => {
    // Bound explicitly rather than left to the globals: this module is imported
    // first precisely so the patches land before pino and undici load.
    await loadTelemetry('http://otel.test:4318');

    expect(registerInstrumentations).toHaveBeenCalledWith(
      expect.objectContaining({ instrumentations: expect.any(Array) }),
    );
    expect(registerInstrumentations.mock.calls[0][0].instrumentations).toHaveLength(3);
  });

  test('shuts down BOTH providers, not just the tracer', async () => {
    // Shutting down only one silently drops the last metrics batch of every
    // deploy, which is the batch anyone looking at a deploy wants.
    const telemetry = await loadTelemetry('http://otel.test:4318');

    await telemetry.shutdownTelemetry();

    expect(tracerShutdown).toHaveBeenCalled();
    expect(meterShutdown).toHaveBeenCalled();
  });

  test('shuts both down concurrently rather than one after the other', async () => {
    // A dying process is on a deadline; two sequential flushes to the same
    // unreachable endpoint is twice the wait for nothing.
    const telemetry = await loadTelemetry('http://otel.test:4318');
    let releaseTracer: () => void = () => {};
    tracerShutdown.mockReturnValue(new Promise<void>((resolve) => (releaseTracer = resolve)));

    const pending = telemetry.shutdownTelemetry();
    await Promise.resolve();

    expect(meterShutdown).toHaveBeenCalled();
    releaseTracer();
    await pending;
  });
});
