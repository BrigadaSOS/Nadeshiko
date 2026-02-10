import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';

let sdk: NodeSDK | undefined;

export function initTelemetry() {
  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  if (!endpoint) return;

  const resource = resourceFromAttributes({
    'service.name': process.env.OTEL_SERVICE_NAME || 'nadeshiko-frontend',
    'service.version': process.env.npm_package_version || '0.0.0',
    'deployment.environment': process.env.NODE_ENV || 'development',
  });

  sdk = new NodeSDK({
    resource,
    traceExporter: new OTLPTraceExporter(),
    metricReader: new PeriodicExportingMetricReader({
      exporter: new OTLPMetricExporter(),
      exportIntervalMillis: 15000,
    }),
  });

  sdk.start();
}

export async function shutdownTelemetry() {
  if (sdk) {
    await sdk.shutdown();
  }
}
