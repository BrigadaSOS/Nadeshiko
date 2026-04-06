import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { resourceFromAttributes, hostDetector } from '@opentelemetry/resources';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { UndiciInstrumentation } from '@opentelemetry/instrumentation-undici';
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-node';

class FilteringSpanProcessor extends BatchSpanProcessor {
  onEnd(span) {
    const name = span.name;
    if (name === 'search-redirect' || name.startsWith('cache:nitro:')) return;
    super.onEnd(span);
  }
}

const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
if (endpoint) {
  const resource = resourceFromAttributes({
    'service.name': process.env.OTEL_SERVICE_NAME || 'nadeshiko-frontend',
    'service.version': process.env.npm_package_version || '0.0.0',
    'deployment.environment': process.env.NUXT_PUBLIC_ENVIRONMENT || 'production',
  });

  const traceExporter = new OTLPTraceExporter();

  const sdk = new NodeSDK({
    resource,
    resourceDetectors: [hostDetector],
    spanProcessors: [new FilteringSpanProcessor(traceExporter)],
    metricReader: new PeriodicExportingMetricReader({
      exporter: new OTLPMetricExporter(),
      exportIntervalMillis: 15000,
    }),
    instrumentations: [
      new HttpInstrumentation({ ignoreOutgoingRequestHook: () => true }),
      new UndiciInstrumentation({
        requestHook: (span, request) => {
          const path = (request.path || '/').split('?')[0];
          span.updateName(`${request.method} ${path}`);
        },
      }),
    ],
  });

  sdk.start();

  const shutdown = async () => {
    await sdk.shutdown();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}
