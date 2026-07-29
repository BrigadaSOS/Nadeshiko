export const ELASTICSEARCH_CLIENT_DEFAULTS = {
  // The v9 client removed v8's 30-second default and otherwise waits indefinitely.
  requestTimeout: 30_000,
} as const;
