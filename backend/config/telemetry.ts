import { trace, metrics } from '@opentelemetry/api';
import type { Meter, Tracer } from '@opentelemetry/api';

// The OTel SDK is initialized in instrumentation.ts (preloaded before the app).
// This module provides access to the global tracer and meter for custom spans/metrics.

export function getMeter(): Meter | undefined {
  const meter = metrics.getMeter('nadeshiko-backend');
  return meter;
}

export function getTracer(): Tracer | undefined {
  const tracer = trace.getTracer('nadeshiko-backend');
  return tracer;
}
