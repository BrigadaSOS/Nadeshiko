import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { MeterProvider, PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { NodeTracerProvider, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-node';
import { trace } from '@opentelemetry/api';
import type { Meter, Tracer } from '@opentelemetry/api';
import { config } from '@config/config';
import packageJson from '../package.json';

let meterProvider: MeterProvider | undefined;
let tracerProvider: NodeTracerProvider | undefined;
let _meter: Meter | undefined;
let _tracer: Tracer | undefined;

export function initTelemetry() {
  if (meterProvider) return;
  if (!config.OTEL_EXPORTER_OTLP_ENDPOINT) return;

  const resource = resourceFromAttributes({
    'service.name': config.OTEL_SERVICE_NAME || 'nadeshiko-backend',
    'service.version': packageJson.version,
    'deployment.environment': config.ENVIRONMENT,
    'deployment.environment.name': config.ENVIRONMENT,
  });

  const traceUrl = `${config.OTEL_EXPORTER_OTLP_ENDPOINT}/v1/traces`;
  const metricsUrl = config.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT || `${config.OTEL_EXPORTER_OTLP_ENDPOINT}/v1/metrics`;

  tracerProvider = new NodeTracerProvider({
    resource,
    spanProcessors: [new SimpleSpanProcessor(new OTLPTraceExporter({ url: traceUrl }))],
  });
  trace.setGlobalTracerProvider(tracerProvider);
  _tracer = tracerProvider.getTracer('nadeshiko-backend');

  const metricReader = new PeriodicExportingMetricReader({
    exporter: new OTLPMetricExporter({ url: metricsUrl }),
    exportIntervalMillis: 15000,
  });
  meterProvider = new MeterProvider({ resource, readers: [metricReader] });
  _meter = meterProvider.getMeter('nadeshiko-backend');
}

export function getMeter(): Meter | undefined {
  return _meter;
}

export function getTracer(): Tracer | undefined {
  return _tracer;
}

export async function shutdownTelemetry() {
  if (tracerProvider) {
    await tracerProvider.shutdown();
  }
  if (meterProvider) {
    await meterProvider.shutdown();
  }
}
