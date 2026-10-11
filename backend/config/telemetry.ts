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

/** Seeded zero-series need periodic DELTA heartbeats: VictoriaMetrics retains the series index but alert lookbacks
 * need a sample. Use the shortest configured lookback (currently 10m) when choosing the interval. */
export const SERIES_HEARTBEAT_INTERVAL_MS = 60_000;

/** Emit the heartbeat immediately, return a stop function, and `unref` the timer so telemetry never keeps the
 * process alive. */
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
