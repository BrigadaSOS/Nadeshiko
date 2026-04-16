// This file MUST be preloaded before the app starts (via --preload flag or bunfig.toml)
// so that auto-instrumentations can hook into modules before they're imported.

import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import {
  OTLPMetricExporter,
  AggregationTemporalityPreference,
} from '@opentelemetry/exporter-metrics-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { ExpressInstrumentation, ExpressLayerType } from '@opentelemetry/instrumentation-express';
import { PgInstrumentation } from '@opentelemetry/instrumentation-pg';
import { PinoInstrumentation } from '@opentelemetry/instrumentation-pino';
import { UndiciInstrumentation } from '@opentelemetry/instrumentation-undici';
import { RuntimeNodeInstrumentation } from '@opentelemetry/instrumentation-runtime-node';

const IGNORED_INCOMING_PATHS = new Set(['/up', '/favicon.ico']);
const IGNORED_INCOMING_PREFIXES = ['/_nuxt/', '/_i18n/'];

function isIgnoredIncoming(url: string): boolean {
  const path = url.split('?')[0];
  if (IGNORED_INCOMING_PATHS.has(path)) return true;
  return IGNORED_INCOMING_PREFIXES.some((p) => path.startsWith(p));
}

const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;

if (endpoint) {
  const resource = resourceFromAttributes({
    'service.name': process.env.OTEL_SERVICE_NAME || 'nadeshiko-backend',
    'service.version': process.env.npm_package_version || '0.0.0',
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
    instrumentations: [
      new HttpInstrumentation({
        ignoreIncomingRequestHook: (req) => isIgnoredIncoming(req.url || ''),
      }),
      new ExpressInstrumentation({
        // Drop middleware and inner handler spans -- they create one span per
        // middleware per request (80k+ series for "middleware - jsonParser"
        // alone) without adding debug value beyond the outer HTTP server span.
        // Also fixes the doubled-route span_name bug caused by nested handlers.
        ignoreLayersType: [ExpressLayerType.MIDDLEWARE, ExpressLayerType.REQUEST_HANDLER],
      }),
      new PgInstrumentation({
        enhancedDatabaseReporting: true,
        requestHook: (span, queryInfo) => {
          const sql = queryInfo.query?.text;
          if (!sql) return;
          const match = sql.match(/\bFROM\s+"?(?:\w+\.)?"?(\w+)"?/i) || sql.match(/\bINTO\s+"?(?:\w+\.)?"?(\w+)"?/i) || sql.match(/\bUPDATE\s+"?(?:\w+\.)?"?(\w+)"?/i);
          if (match?.[1]) {
            const table = match[1];
            const op = sql.trimStart().split(/\s/)[0].toUpperCase();
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

  const shutdown = async () => {
    await sdk.shutdown();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}
