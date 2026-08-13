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
    // The pg instrumentation's connection-pool metrics are unusable, and they
    // collide by name with the honest ones `config/database.ts` publishes.
    //
    // Its `updateCounter` (instrumentation-pg utils.js) keeps ONE shared
    // `_connectionsCounter` baseline for the whole process but emits each delta
    // under the pool's own `db.client.connection.pool_name`. We run three pools
    // -- TypeORM, better-auth, and pg-boss (built from a connectionString, so
    // its host/port/database are undefined and it reports as
    // `unknown_host:unknown_port/unknown_database`). Every callback therefore
    // diffs against whichever pool happened to run last, and the two names
    // ping-pong the same baseline: the series come out as exact mirror images,
    // +N on one and -N on the other. Exported as DELTA above and accumulated on
    // ingest, that drifts without bound -- it read 528 "pending requests" and
    // 866,939 "idle connections" against a pool whose max is 15, and it paged
    // us at 06:14 JST on 2026-08-13 while the real queue depth was 0.
    //
    // Dropping them costs no real coverage (the numbers were never true) and
    // leaves the observable gauges in `config/database.ts` as the only
    // publisher of these names.
    //
    // `db.client.operation.duration` goes too, for a different reason: it
    // measures the same thing as `db.postgresql.operation.duration` from
    // InstrumentedTypeOrmLogger, and measures it worse. It derives the
    // operation name by slicing raw SQL, which splits one operation across
    // several series -- prod carried `SELECT` and `SELECT\n`, `WITH` and
    // `WITH\n`, `BEGIN;\n` -- while the TypeORM logger normalises the verb and
    // also attributes `db.collection.name` and counts errors, which the pg
    // instrumentation does not. Neither metric backs any dashboard or alert
    // today, so this is a straight removal of the weaker duplicate.
    //
    // The trade-off, stated: the TypeORM logger only sees TypeORM's pool, so
    // better-auth and pg-boss queries lose METRIC coverage here. They keep
    // their spans -- views apply to metrics only, and `pg.query:*` is
    // untouched, which is the part of the pg instrumentation worth having.
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
      // NO ExpressInstrumentation. It cannot work here and removing it stops the
      // file from implying otherwise.
      //
      // `package.json` sets `"type": "module"`, so `import express from
      // 'express'` resolves through the ESM path, while the instrumentation
      // monkey-patches via require-in-the-middle. Verified on the host
      // 2026-08-13: under `"type": "module"` `Router.prototype.route.__wrapped`
      // is false, under CJS it is true, and adding
      // `@opentelemetry/instrumentation/hook.mjs` to the run command does not
      // change it in either load order. It produced no spans at all -- prod
      // span names were `pg.query:*`, `GET` and `POST`, with nothing from
      // express -- so the `ignoreLayersType` tuning it used to carry was
      // describing a config that had no effect.
      //
      // `http.route` is published directly instead, in config/routes.ts. pg is
      // unaffected: it patches through inner CommonJS requires and IS wrapped
      // under ESM.
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

  const shutdown = async () => {
    await sdk.shutdown();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}
