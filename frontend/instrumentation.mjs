import { createRequire } from 'node:module';
import { SpanStatusCode } from '@opentelemetry/api';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import {
  OTLPMetricExporter,
  AggregationTemporalityPreference,
} from '@opentelemetry/exporter-metrics-otlp-http';
import { resourceFromAttributes, hostDetector, processDetector } from '@opentelemetry/resources';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { PinoInstrumentation } from '@opentelemetry/instrumentation-pino';
import { UndiciInstrumentation } from '@opentelemetry/instrumentation-undici';
import { RuntimeNodeInstrumentation } from '@opentelemetry/instrumentation-runtime-node';
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-node';
import { normalizeRoute, isIgnoredPath } from './route-normalization.mjs';

const require = createRequire(import.meta.url);

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
    // npm sets npm_package_version only for processes it launches, and the
    // container's CMD is a bare `node`, so in production this read every
    // deployed build as `0.0.0` -- telemetry could not say which one was live,
    // which is the question you ask first when a metric changes shape.
    // OTEL_SERVICE_VERSION comes from package.json via config/deploy.prod.yml;
    // npm_package_version stays as the fallback for `npm run` locally.
    'service.version': process.env.OTEL_SERVICE_VERSION || process.env.npm_package_version || '0.0.0',
    'deployment.environment': process.env.NUXT_PUBLIC_ENVIRONMENT || 'production',
  });

  const traceExporter = new OTLPTraceExporter();

  const sdk = new NodeSDK({
    resource,
    resourceDetectors: [hostDetector, processDetector],
    spanProcessors: [new FilteringSpanProcessor(traceExporter)],
    metricReader: new PeriodicExportingMetricReader({
      exporter: new OTLPMetricExporter({
        temporalityPreference: AggregationTemporalityPreference.DELTA,
      }),
      exportIntervalMillis: 15000,
    }),
    instrumentations: [
      new HttpInstrumentation({
        ignoreOutgoingRequestHook: () => true,
        ignoreIncomingRequestHook: (req) => isIgnoredPath(req.url || ''),
      }),
      new PinoInstrumentation(),
      new RuntimeNodeInstrumentation(),
      new UndiciInstrumentation({
        requestHook: (span, request) => {
          const rawPath = (request.path || '/').split('?')[0];
          const route = normalizeRoute(rawPath);
          span.updateName(`${request.method} ${route}`);
          span.setAttribute('http.route', route);
        },
        responseHook: (span, { response }) => {
          const statusCode = response.statusCode;
          if (statusCode >= 400) {
            span.setStatus({
              code: SpanStatusCode.ERROR,
              message: `HTTP ${statusCode}`,
            });
          }
        },
      }),
    ],
  });

  sdk.start();

  // Force CJS require of http/https after sdk.start() so HttpInstrumentation
  // can patch them via the CJS hook. ESM import-in-the-middle doesn't intercept
  // built-in node: modules, but the prototype patches from CJS are shared with
  // ESM references to the same module.
  require('http');
  require('https');

  const shutdown = async () => {
    await sdk.shutdown();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}
