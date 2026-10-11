// Elasticsearch transport emits its own client spans once a tracer provider exists; no extra instrumentation setup is
// needed unless `OTEL_ELASTICSEARCH_ENABLED=false`.
export const ELASTICSEARCH_CLIENT_DEFAULTS = {
  // The v9 client removed v8's 30-second default and otherwise waits indefinitely.
  requestTimeout: 30_000,
} as const;
