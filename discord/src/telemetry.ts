// This module MUST be the FIRST import in the bot entrypoint so providers
// are registered before pino / undici / discord.js are loaded. Otherwise
// instrumentation hooks miss their patch windows and meters captured at
// module load (e.g. instrumentation.ts) bind to no-op providers.

import { context, metrics, propagation, trace, type Meter, type Tracer } from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import { CompositePropagator, W3CBaggagePropagator, W3CTraceContextPropagator } from '@opentelemetry/core';
import { AggregationTemporalityPreference, OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { registerInstrumentations } from '@opentelemetry/instrumentation';
import { PinoInstrumentation } from '@opentelemetry/instrumentation-pino';
import { RuntimeNodeInstrumentation } from '@opentelemetry/instrumentation-runtime-node';
import { UndiciInstrumentation } from '@opentelemetry/instrumentation-undici';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { MeterProvider, PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { BatchSpanProcessor, TracerProvider } from '@opentelemetry/sdk-trace';
import packageJson from '../package.json';

let tracerProvider: TracerProvider | undefined;
let meterProvider: MeterProvider | undefined;

const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;

if (endpoint) {
  const resource = resourceFromAttributes({
    'service.name': process.env.OTEL_SERVICE_NAME || 'nadeshiko-discord',
    'service.version': packageJson.version,
    'deployment.environment': process.env.NODE_ENV || 'development',
  });

  tracerProvider = new TracerProvider({
    resource,
    spanProcessors: [new BatchSpanProcessor({ exporter: new OTLPTraceExporter() })],
  });
  // sdk-trace 3 dropped NodeTracerProvider.register(); these three calls are what it did.
  context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
  propagation.setGlobalPropagator(
    new CompositePropagator({ propagators: [new W3CTraceContextPropagator(), new W3CBaggagePropagator()] }),
  );
  trace.setGlobalTracerProvider(tracerProvider);

  meterProvider = new MeterProvider({
    resource,
    readers: [
      new PeriodicExportingMetricReader({
        exporter: new OTLPMetricExporter({
          temporalityPreference: AggregationTemporalityPreference.DELTA,
        }),
        exportIntervalMillis: 15000,
      }),
    ],
  });
  metrics.setGlobalMeterProvider(meterProvider);

  registerInstrumentations({
    tracerProvider,
    meterProvider,
    instrumentations: [new PinoInstrumentation(), new UndiciInstrumentation(), new RuntimeNodeInstrumentation()],
  });
}

export function getMeter(): Meter {
  return metrics.getMeter('nadeshiko-discord');
}

export function getTracer(): Tracer {
  return trace.getTracer('nadeshiko-discord');
}

export async function shutdownTelemetry() {
  await Promise.all([tracerProvider?.shutdown(), meterProvider?.shutdown()]);
}
