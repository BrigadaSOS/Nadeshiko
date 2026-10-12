import cluster from 'node:cluster';
import { metrics } from '@opentelemetry/api';
import { env } from '~~/config/env';
import { isReservedLocalePath } from '~~/server/utils/localeRouting';
import { logger } from '~~/server/utils/logger';
import { presentsBypassSecret, RATE_LIMIT_BYPASS_HEADER } from '~~/server/utils/rateLimitBypass';
import { createAdmissionGate } from '~~/server/utils/ssrAdmission';

// Cap renders per process; per-IP limits cannot bound distributed load. GET and HEAD both render, while reserved
// routes and the CI bypass do not consume slots. Useful concurrency overlaps backend waits without an unbounded queue.
// Eight slots bound each worker's render heap; at ~400ms per render under load, the original sizing estimated ~3s
// worst-case wait. Measured human peak was 0.67 renders/s against ~6/s capacity per worker (week to 2026-08-31).
// At capacity, return a plain 503 with Retry-After: createError would invoke the SSR error page we are refusing.
// Release on both finish and close, idempotently, so disconnects cannot leak slots.

const meter = metrics.getMeter('nadeshiko-frontend');

const rejectedCount = meter.createCounter('ssr.admission.rejected', {
  description: 'Page renders refused because this process was already at its in-flight cap',
  unit: '{request}',
});

const inFlightGauge = meter.createUpDownCounter('ssr.admission.in_flight', {
  description: 'Page renders currently admitted and being served by this process',
  unit: '{request}',
});

// Seed and refresh the delta metric so idle periods report zero, not NO DATA. unref avoids keeping the process alive.
const SERIES_HEARTBEAT_MS = 60_000;
rejectedCount.add(0);
setInterval(() => rejectedCount.add(0), SERIES_HEARTBEAT_MS).unref();

const gate = createAdmissionGate(env.NUXT_SSR_MAX_INFLIGHT);

const RETRY_AFTER_SECONDS = 2;

// Throttle refusal logs so floods cannot overwhelm logging.
const LOG_INTERVAL_MS = 10_000;
let lastLoggedAt = 0;
let refusedSinceLog = 0;

export default defineEventHandler((event) => {
  if (event.method !== 'GET' && event.method !== 'HEAD') return;
  // Earlier middleware can await I/O after the client has disconnected. Its
  // close event has already happened, so attaching cleanup now would leak a slot.
  if (event.node.res.destroyed || event.node.res.writableEnded) return '';

  const path = getRequestURL(event).pathname;
  if (isReservedLocalePath(path)) return;

  if (presentsBypassSecret(getRequestHeader(event, RATE_LIMIT_BYPASS_HEADER), env.NUXT_RATE_LIMIT_BYPASS_SECRET)) {
    return;
  }

  const release = gate.tryAcquire();
  if (!release) {
    rejectedCount.add(1);
    refusedSinceLog += 1;
    const now = Date.now();
    if (now - lastLoggedAt >= LOG_INTERVAL_MS) {
      logger.warn(
        { path, inFlight: gate.inFlight(), max: gate.max, refused: refusedSinceLog, worker: cluster.worker?.id ?? 0 },
        'ssr admission: at capacity, refusing renders',
      );
      lastLoggedAt = now;
      refusedSinceLog = 0;
    }

    setResponseStatus(event, 503, 'Service Unavailable');
    setResponseHeader(event, 'Retry-After', String(RETRY_AFTER_SECONDS));
    setResponseHeader(event, 'Cache-Control', 'no-store');
    setResponseHeader(event, 'Content-Type', 'text/plain; charset=utf-8');
    setResponseHeader(event, 'X-Nd-Admission', 'refused');
    return 'Nadeshiko is busy right now. Please retry in a moment.';
  }

  inFlightGauge.add(1);
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    release();
    inFlightGauge.add(-1);
  };
  event.node.res.once('finish', finish);
  event.node.res.once('close', finish);
});
