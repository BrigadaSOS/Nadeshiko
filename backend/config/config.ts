import { z } from 'zod/v3';

const emptyToUndefined = z
  .string()
  .optional()
  .transform((v) => v || undefined);

const envSchema = z.object({
  // Core
  ENVIRONMENT: z.string().default('local'),
  PORT: z.coerce.number().int().positive().default(5000),
  UUID_NAMESPACE: z.string().uuid(),
  R2_BASE_URL: z.string().url(),
  LOCAL_BASE_URL: z.string().default('/media'),
  MEDIA_FILES_PATH: z.string().default('../media'),

  // Postgres
  POSTGRES_HOST: z.string(),
  POSTGRES_PORT: z.coerce.number().int().positive().default(5432),
  POSTGRES_USER: z.string(),
  POSTGRES_PASSWORD: z.string(),
  POSTGRES_DB: z.string(),
  POSTGRES_ADMIN_HOST: z.string().optional(),
  POSTGRES_ADMIN_PORT: z.coerce.number().int().positive().optional(),
  POSTGRES_ADMIN_USER: z.string().optional(),
  POSTGRES_ADMIN_PASSWORD: z.string().optional(),
  POSTGRES_ADMIN_DB: z.string().optional(),

  // Elasticsearch
  ELASTICSEARCH_HOST: z.string(),
  ELASTICSEARCH_USER: z.string(),
  ELASTICSEARCH_PASSWORD: z.string(),
  ELASTICSEARCH_INDEX: z.string().optional(),
  ELASTICSEARCH_ADMIN_USER: z.string().optional(),
  ELASTICSEARCH_ADMIN_PASSWORD: emptyToUndefined,

  // Auth / API
  BETTER_AUTH_SECRET: z.string().optional(),
  ALLOWED_WEBSITE_URLS: z.string().default(''),
  BASE_URL: z.string(),
  USERNAME_API_NADEDB: z.string().optional(),
  PASSWORD_API_NADEDB: z.string().optional(),
  EMAIL_API_NADEDB: z.string().optional(),

  // Rate limiting
  ORIGIN_SAFETY_WINDOW_MS: z.coerce.number().int().positive().default(60000),
  ORIGIN_SAFETY_LIMIT: z.coerce.number().int().positive().default(2000),
  API_KEY_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(300000),
  API_KEY_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(2000),

  // OAuth (optional - features disabled when absent)
  ID_OAUTH_GOOGLE: emptyToUndefined,
  SECRET_OAUTH_GOOGLE: emptyToUndefined,
  DISCORD_CLIENT_ID: emptyToUndefined,
  DISCORD_CLIENT_SECRET: emptyToUndefined,

  // Email (SES)
  SES_AWS_REGION: emptyToUndefined,
  SES_AWS_ACCESS_KEY_ID: emptyToUndefined,
  SES_AWS_SECRET_ACCESS_KEY: emptyToUndefined,
  SES_FROM_EMAIL: z.string().default('noreply@nadeshiko.co'),
  SES_FROM_NAME: z.string().default('Nadeshiko'),

  // Telemetry
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().optional(),
  OTEL_SERVICE_NAME: z.string().optional(),

  // Misc
  LOG_LEVEL: z.string().optional(),
  NODE_ENV: z.string().optional(),
  DATABASE_URL: z.string().optional(),
});

export const config = envSchema.parse(process.env);
export type AppConfig = z.infer<typeof envSchema>;
