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
