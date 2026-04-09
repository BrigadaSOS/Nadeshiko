import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { PinoInstrumentation } from '@opentelemetry/instrumentation-pino';
import { UndiciInstrumentation } from '@opentelemetry/instrumentation-undici';
import { RuntimeNodeInstrumentation } from '@opentelemetry/instrumentation-runtime-node';
import { metrics, trace, type Meter, type Tracer } from '@opentelemetry/api';
import packageJson from '../package.json';

let sdk: NodeSDK | undefined;

export function initTelemetry() {
  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  if (sdk || !endpoint) return;

  const resource = resourceFromAttributes({
    'service.name': process.env.OTEL_SERVICE_NAME || 'nadeshiko-discord',
    'service.version': packageJson.version,
    'deployment.environment': process.env.NODE_ENV || 'development',
  });

  sdk = new NodeSDK({
    resource,
    traceExporter: new OTLPTraceExporter(),
    metricReader: new PeriodicExportingMetricReader({
      exporter: new OTLPMetricExporter(),
      exportIntervalMillis: 15000,
    }),
    instrumentations: [new PinoInstrumentation(), new UndiciInstrumentation(), new RuntimeNodeInstrumentation()],
  });

  sdk.start();
}

export function getMeter(): Meter {
  return metrics.getMeter('nadeshiko-discord');
}

export function getTracer(): Tracer {
  return trace.getTracer('nadeshiko-discord');
}

export async function shutdownTelemetry() {
  if (sdk) await sdk.shutdown();
}
