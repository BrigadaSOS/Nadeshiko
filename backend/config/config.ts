import { z } from 'zod/v4';

const optionalString = z
  .string()
  .optional()
  .transform((v) => v || undefined);

const requiredString = z.string().trim().min(1);

const envSchema = z.object({
  ENVIRONMENT: z.enum(['local', 'dev', 'prod']),
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

  ID_OAUTH_GOOGLE: optionalString,
  SECRET_OAUTH_GOOGLE: optionalString,
  DISCORD_CLIENT_ID: optionalString,
  DISCORD_CLIENT_SECRET: optionalString,

  SES_AWS_REGION: optionalString,
  SES_AWS_ACCESS_KEY_ID: optionalString,
  SES_AWS_SECRET_ACCESS_KEY: optionalString,
  SES_FROM_EMAIL: requiredString,
  SES_FROM_NAME: requiredString,

  SENTRY_BACKEND_DSN: optionalString,

  OTEL_EXPORTER_OTLP_ENDPOINT: optionalString,
  OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: optionalString,
  OTEL_SERVICE_NAME: optionalString,

  DB_SLOW_QUERY_THRESHOLD_MS: z.coerce.number().int().nonnegative().default(200),

  LOG_LEVEL: optionalString,
  DB_LOG_LEVEL: optionalString,
});

export const config: Readonly<z.infer<typeof envSchema>> = Object.freeze(envSchema.parse(process.env));
export type AppConfig = z.infer<typeof envSchema>;
