import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { MeterProvider, PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { NodeTracerProvider, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-node';
import { trace, type Meter, type Tracer } from '@opentelemetry/api';
import packageJson from '../package.json';

let meterProvider: MeterProvider | undefined;
let tracerProvider: NodeTracerProvider | undefined;
let _meter: Meter | undefined;
let _tracer: Tracer | undefined;

export function initTelemetry() {
  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  if (meterProvider || !endpoint) return;

  const resource = resourceFromAttributes({
    'service.name': process.env.OTEL_SERVICE_NAME || 'nadeshiko-discord',
    'service.version': packageJson.version,
    'deployment.environment': process.env.NODE_ENV || 'development',
    'deployment.environment.name': process.env.NODE_ENV || 'development',
  });

  const traceUrl = `${endpoint}/v1/traces`;
  const metricsUrl = process.env.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT || `${endpoint}/v1/metrics`;

  tracerProvider = new NodeTracerProvider({
    resource,
    spanProcessors: [new SimpleSpanProcessor(new OTLPTraceExporter({ url: traceUrl }))],
  });
  trace.setGlobalTracerProvider(tracerProvider);
  _tracer = tracerProvider.getTracer('nadeshiko-discord');

  const metricReader = new PeriodicExportingMetricReader({
    exporter: new OTLPMetricExporter({ url: metricsUrl }),
    exportIntervalMillis: 15000,
  });
  meterProvider = new MeterProvider({ resource, readers: [metricReader] });
  _meter = meterProvider.getMeter('nadeshiko-discord');
}

export function getMeter(): Meter | undefined {
  return _meter;
}

export function getTracer(): Tracer | undefined {
  return _tracer;
}

export async function shutdownTelemetry() {
  if (tracerProvider) await tracerProvider.shutdown();
  if (meterProvider) await meterProvider.shutdown();
}
