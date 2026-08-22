import { trace, metrics } from '@opentelemetry/api';
import type { Meter, Tracer } from '@opentelemetry/api';

// The OTel SDK is initialized in instrumentation.ts (preloaded before the app).
// This module provides access to the global tracer and meter for custom spans/metrics.

export function getMeter(): Meter {
  return metrics.getMeter('nadeshiko-backend');
}

export function getTracer(): Tracer {
  return trace.getTracer('nadeshiko-backend');
}

/**
 * How often the seeded zero-series are re-emitted.
 *
 * SEEDING ONCE AT BOOT IS NOT ENOUGH, and this is the part that looks done and
 * is not. `seedEmailSeries()` and `seedRateLimitSeries()` create every
 * enumerable series at zero so their alert rules have something to read -- but
 * this process exports DELTA temporality (instrumentation.ts,
 * `AggregationTemporalityPreference.DELTA`), and a delta export carries only the
 * attribute sets that recorded a measurement since the last collection. So a
 * counter that is seeded and never touched emits ONE data point and then goes
 * silent forever.
 *
 * The series stays in VictoriaMetrics' index, which is what makes this so hard
 * to see: /api/v1/series lists it, the metric looks present, and the rule still
 * reads nothing -- because `sum_over_time(...[1h])` needs a SAMPLE IN THE
 * WINDOW, not an entry in the index. An hour after each deploy the boot sample
 * falls out and the rule goes back to matching nothing.
 *
 * Measured on 2026-08-21/22: `seedEmailSeries()` is in the deployed image and
 * NadeshikoEmailWebhookMisconfigured and NadeshikoEmailWebhookAuthFailing were
 * still tripping NadeshikoAlertRuleMatchesNothing about an hour after every
 * restart, resolving on each deploy and coming back. Verified against the SDK
 * directly: with a delta reader, `counter.add(0)` produces a zero-valued data
 * point in the NEXT export and nothing at all in the ones after it.
 *
 * One minute, because the binding constraint is the shortest lookback window any
 * rule uses over these counters -- 10m, on the rate-limit rules in
 * brigadasos-infra. Shorten a rule window below a few minutes and this has to
 * come down with it.
 */
export const SERIES_HEARTBEAT_INTERVAL_MS = 60_000;

/**
 * Re-emit the seeded zero-series on an interval, so the rules that read them
 * keep having something to read.
 *
 * Emits once immediately -- the caller does not also need to seed -- and returns
 * the stop function. The timer is `unref`d so it never holds the process open;
 * a heartbeat is not a reason to stay alive.
 */
export function startSeriesHeartbeat(
  emitters: Array<() => void>,
  intervalMs: number = SERIES_HEARTBEAT_INTERVAL_MS,
): () => void {
  const emit = (): void => {
    for (const emitter of emitters) {
      emitter();
    }
  };

  emit();
  const timer = setInterval(emit, intervalMs);
  timer.unref();

  return () => clearInterval(timer);
}
