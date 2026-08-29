import cluster from 'node:cluster';
import { metrics } from '@opentelemetry/api';
import { env } from '~~/config/env';
import { isReservedLocalePath } from '~~/server/utils/localeRouting';
import { logger } from '~~/server/utils/logger';
import { presentsBypassSecret, RATE_LIMIT_BYPASS_HEADER } from '~~/server/utils/rateLimitBypass';
import { createAdmissionGate } from '~~/server/utils/ssrAdmission';

/**
 * Admission control for page renders: at most `NUXT_SSR_MAX_INFLIGHT` of them
 * in this process at once, and an immediate 503 for the next.
 *
 * WHAT IT ANSWERS. The per-IP limiter next door (99-rate-limit-html.ts) asks how
 * much one address has sent. On 2026-08-30 22:15 UTC that question had no
 * useful answer: 110,340 search renders arrived from 108,685 addresses in 45
 * minutes, one each, and every one of them was admitted. The single Nitro
 * process took 40-90 renders a second against a ceiling it had itself measured
 * at ~6.4, queued the rest, watched latency climb past kamal-proxy's timeout,
 * and kept rendering pages whose clients had already hung up (46k `499`s). The
 * host sat at 61-74% CPU while serving 189 successful search pages out of
 * 60,000 requests, and readers on unrelated pages got 502/504 for it.
 *
 * This asks the other question -- am I already doing as much of this as I can
 * -- and past the cap the answer costs microseconds and takes no slot. The
 * cores stay with the renders already admitted, throughput under a flood holds
 * at the ceiling instead of falling to zero, and the failure readers see is "a
 * search page said try again" rather than "the site is down".
 *
 * HOW THE NUMBER WAS CHOSEN. One render is ~0.14 core-seconds end to end
 * (measured 2026-08-29: 2.0-2.5 renders/s cost ~10 points of a 4-core box), and
 * a worker is one event loop, so its useful concurrency is small: a few renders
 * overlapping their backend waits. At 8 in flight and ~400ms per render under
 * load, the worst-case queueing a reader sees is ~3s before either a page or a
 * 503, and the process never holds more than 8 renders' worth of heap -- which
 * is what makes the memory numbers in deploy.prod.yml hold. It is per process:
 * two workers admit sixteen between them.
 *
 * WHAT IT COSTS. Nothing, at every load this site has seen from humans: the
 * busiest hour in the week to 2026-08-31 was 2,407 renders, or 0.67/s, against
 * a ceiling near 6/s per worker. The cap is met only by floods.
 *
 * WHY 503 AND NOT 429. Nothing about the caller is being counted, so there is
 * no budget it could have stayed inside; the honest statement is "not right
 * now". 503 with `Retry-After` is also what every crawler treats as "back off
 * and keep the index", where a 429 or a 5xx page can be read as the URL being
 * broken.
 *
 * WHY A PLAIN RESPONSE AND NOT `createError`. A thrown error is rendered through
 * Nuxt's error page, which is itself an SSR render -- exactly the work being
 * refused. Returning the body directly ends the request in h3 without touching
 * Vue at all.
 *
 * SCOPE. Renders only: the reserved set (`/v1/` proxy, `/api/`, assets, /up,
 * sitemaps) passes straight through, both because none of it is a render and
 * because a search page's client-side navigation calls `/v1/search` on this host
 * -- refusing THAT would break the app for the readers this exists to protect.
 * HEAD is counted with GET: Nitro renders the page for both. The CI bypass is
 * honoured for the same reason the limiter honours it -- ~140 tests from one
 * runner would meet an 8-slot gate on staging's single process.
 *
 * RELEASE ON `finish` AND `close`, idempotently. A clean response fires both, an
 * aborted one fires only `close`, and a slot leaked on an abort is one the
 * flood never gives back.
 */

const meter = metrics.getMeter('nadeshiko-frontend');

const rejectedCount = meter.createCounter('ssr.admission.rejected', {
  description: 'Page renders refused because this process was already at its in-flight cap',
  unit: '{request}',
});

const inFlightGauge = meter.createUpDownCounter('ssr.admission.in_flight', {
  description: 'Page renders currently admitted and being served by this process',
  unit: '{request}',
});

// Seeded at zero and re-emitted every minute, for the same reason the backend's
// rate-limit series are: metrics leave this process as DELTAS (instrumentation
// .mjs), so a counter that has never been touched has no series at all, and
// NadeshikoFrontendProdSheddingLoad in brigadasos-infra would read NO DATA
// rather than zero -- and NadeshikoAlertRuleMatchesNothing would flag it. One
// minute stays under that rule's 10m window. `unref` so a heartbeat is never a
// reason to keep the process alive.
const SERIES_HEARTBEAT_MS = 60_000;
rejectedCount.add(0);
setInterval(() => rejectedCount.add(0), SERIES_HEARTBEAT_MS).unref();

const gate = createAdmissionGate(env.NUXT_SSR_MAX_INFLIGHT);

const RETRY_AFTER_SECONDS = 2;

// One line per ten seconds per process, not one per refusal: at 40 renders a
// second refused, the log would otherwise be the next thing to fall over.
const LOG_INTERVAL_MS = 10_000;
let lastLoggedAt = 0;
let refusedSinceLog = 0;

export default defineEventHandler((event) => {
  if (event.method !== 'GET' && event.method !== 'HEAD') return;

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
