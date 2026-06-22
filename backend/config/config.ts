import { z } from 'zod/v4';

const optionalString = z
  .string()
  .optional()
  .transform((v) => v || undefined);

const requiredString = z.string().trim().min(1);

const booleanString = z
  .enum(['true', 'false'])
  .default('false')
  .transform((v) => v === 'true');

const envSchema = z.object({
  ENVIRONMENT: z.enum(['local', 'development', 'production']),
  PORT: z.coerce.number().int().positive(),
  UUID_NAMESPACE: z.string().uuid(),
  R2_BASE_URL: z.string().url(),

  POSTGRES_HOST: requiredString,
  POSTGRES_PORT: z.coerce.number().int().positive(),
  POSTGRES_USER: requiredString,
  POSTGRES_PASSWORD: requiredString,
  POSTGRES_DB: requiredString,
  POSTGRES_ADMIN_HOST: optionalString,
  POSTGRES_ADMIN_PORT: z.coerce.number().int().positive().optional(),
  POSTGRES_ADMIN_USER: optionalString,
  POSTGRES_ADMIN_PASSWORD: optionalString,
  POSTGRES_ADMIN_DB: optionalString,

  ELASTICSEARCH_HOST: requiredString,
  ELASTICSEARCH_USER: requiredString,
  ELASTICSEARCH_PASSWORD: requiredString,
  ELASTICSEARCH_INDEX: requiredString,
  ELASTICSEARCH_ADMIN_USER: optionalString,
  ELASTICSEARCH_ADMIN_PASSWORD: optionalString,

  BETTER_AUTH_SECRET: requiredString,
  ALLOWED_WEBSITE_URLS: z.string().default(''),
  BASE_URL: requiredString,
  USERNAME_API_NADEDB: requiredString,
  EMAIL_API_NADEDB: requiredString,
  API_KEY_MASTER: requiredString,

  API_KEY_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60000),
  API_KEY_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(150),

  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  RATE_LIMIT_MAX_REQUESTS_PER_IP: z.coerce.number().int().positive().default(300),
  RATE_LIMIT_AUTH_MAX_REQUESTS_PER_IP: z.coerce.number().int().positive().default(60),

  // Shared secret proving a request came through our own frontend Nitro proxy
  // (which already rate-limits per real client IP). When set, the per-IP
  // backend limiter exempts requests carrying it. Must match the frontend's
  // NUXT_INTERNAL_PROXY_SECRET. Left unset = no exemption (fail-safe: traffic is
  // limited, never silently bypassed).
  INTERNAL_PROXY_SECRET: optionalString,

  ID_OAUTH_GOOGLE: optionalString,
  SECRET_OAUTH_GOOGLE: optionalString,
  DISCORD_CLIENT_ID: optionalString,
  DISCORD_CLIENT_SECRET: optionalString,

  E2E_USER_PASSWORD: optionalString,

  SES_AWS_REGION: optionalString,
  SES_AWS_ACCESS_KEY_ID: optionalString,
  SES_AWS_SECRET_ACCESS_KEY: optionalString,
  SES_FROM_EMAIL: requiredString,
  SES_FROM_NAME: requiredString,

  OTEL_EXPORTER_OTLP_ENDPOINT: optionalString,
  OTEL_SERVICE_NAME: optionalString,

  DB_SLOW_QUERY_THRESHOLD_MS: z.coerce.number().int().nonnegative().default(200),

  // When enabled, pending TypeORM migrations run automatically on app boot
  // (before workers start). Set to "true" in deployed environments so a deploy
  // applies schema changes; left off for local/test where the schema is managed
  // explicitly via the db: scripts.
  RUN_MIGRATIONS_ON_BOOT: booleanString,

  LOG_LEVEL: optionalString,
  DB_LOG_LEVEL: optionalString,
});

export const config: Readonly<z.infer<typeof envSchema>> = Object.freeze(envSchema.parse(process.env));
export type AppConfig = z.infer<typeof envSchema>;
