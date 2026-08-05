// Elasticsearch query latency needs no OpenTelemetry instrumentation package:
// @elastic/transport emits its own CLIENT spans (named after the API call, carrying
// db.operation.name / db.collection.name / db.response.status_code) whenever a
// tracer provider is registered. It is on by default and opts out only via
// OTEL_ELASTICSEARCH_ENABLED=false, so nothing needs to be set here to enable it.
export const ELASTICSEARCH_CLIENT_DEFAULTS = {
  // The v9 client removed v8's 30-second default and otherwise waits indefinitely.
  requestTimeout: 30_000,
} as const;
