// This file MUST be preloaded before the app starts (via --preload flag or bunfig.toml)
// so that auto-instrumentations can hook into modules before they're imported.

import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { OTLPMetricExporter, AggregationTemporalityPreference } from '@opentelemetry/exporter-metrics-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { AggregationType, PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { PgInstrumentation } from '@opentelemetry/instrumentation-pg';
import { PinoInstrumentation } from '@opentelemetry/instrumentation-pino';
import { UndiciInstrumentation } from '@opentelemetry/instrumentation-undici';
import { RuntimeNodeInstrumentation } from '@opentelemetry/instrumentation-runtime-node';
import { registerTelemetryShutdown } from './config/telemetry';

const IGNORED_INCOMING_PATHS = new Set(['/up', '/favicon.ico']);
const IGNORED_INCOMING_PREFIXES = ['/_nuxt/', '/_i18n/'];

function isIgnoredIncoming(url: string): boolean {
  const path = url.split('?')[0] ?? url;
  if (IGNORED_INCOMING_PATHS.has(path)) return true;
  return IGNORED_INCOMING_PREFIXES.some((p) => path.startsWith(p));
}

const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;

if (endpoint) {
  const resource = resourceFromAttributes({
    'service.name': process.env.OTEL_SERVICE_NAME || 'nadeshiko-backend',
    // Use `OTEL_SERVICE_VERSION` in containers because bare `node` does not set npm’s package version; keep
    // `npm_package_version` as the local fallback.
    'service.version': process.env.OTEL_SERVICE_VERSION || process.env.npm_package_version || '0.0.0',
    'deployment.environment': process.env.ENVIRONMENT || 'production',
  });

  const sdk = new NodeSDK({
    resource,
    traceExporter: new OTLPTraceExporter(),
    metricReader: new PeriodicExportingMetricReader({
      exporter: new OTLPMetricExporter({
        temporalityPreference: AggregationTemporalityPreference.DELTA,
      }),
      exportIntervalMillis: 15000,
    }),
    // Drop pg pool gauges: their cross-pool delta baseline produces false values; keep query spans. Drop duplicate
    // durations in favor of TypeORM metrics, accepting lost metric coverage for better-auth and pg-boss.
    views: [
      {
        meterName: '@opentelemetry/instrumentation-pg',
        instrumentName: 'db.client.connection.*',
        aggregation: { type: AggregationType.DROP },
      },
      {
        meterName: '@opentelemetry/instrumentation-pg',
        instrumentName: 'db.client.operation.duration',
        aggregation: { type: AggregationType.DROP },
      },
    ],
    instrumentations: [
      new HttpInstrumentation({
        ignoreIncomingRequestHook: (req) => isIgnoredIncoming(req.url || ''),
      }),
      // Do not configure ExpressInstrumentation: this ESM import path is not patched by the package, even with the hook
      // preload. Publish bounded `http.route` in `config/routes.ts`; pg instrumentation still works.
      new PgInstrumentation({
        enhancedDatabaseReporting: true,
        requestHook: (span, queryInfo) => {
          const sql = queryInfo.query?.text;
          if (!sql) return;
          const match =
            sql.match(/\bFROM\s+"?(?:\w+\.)?"?(\w+)"?/i) ||
            sql.match(/\bINTO\s+"?(?:\w+\.)?"?(\w+)"?/i) ||
            sql.match(/\bUPDATE\s+"?(?:\w+\.)?"?(\w+)"?/i);
          if (match?.[1]) {
            const table = match[1];
            const op = (sql.trimStart().split(/\s/)[0] ?? '').toUpperCase();
            span.updateName(`pg.query:${op} ${table}`);
          }
        },
      }),
      new PinoInstrumentation(),
      new UndiciInstrumentation(),
      new RuntimeNodeInstrumentation(),
    ],
  });

  sdk.start();

  registerTelemetryShutdown(() => sdk.shutdown());
}
