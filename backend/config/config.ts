import { z } from 'zod/v3';

const emptyToUndefined = z
  .string()
  .optional()
  .transform((v) => v || undefined);

const requiredString = z.string().trim().min(1);

const envSchema = z.object({
  ENVIRONMENT: z.enum(['local', 'dev', 'prod']),
  APP_VERSION: z.string().default('0.0.0'),
  PORT: z.coerce.number().int().positive().default(5000),
  UUID_NAMESPACE: z.string().uuid(),
  R2_BASE_URL: z.string().url(),
  LOCAL_BASE_URL: z.string().default('/media'),
  MEDIA_FILES_PATH: z.string().default('../media'),

  POSTGRES_HOST: requiredString,
  POSTGRES_PORT: z.coerce.number().int().positive().default(5432),
  POSTGRES_USER: requiredString,
  POSTGRES_PASSWORD: requiredString,
  POSTGRES_DB: requiredString,
  POSTGRES_ADMIN_HOST: z.string().optional(),
  POSTGRES_ADMIN_PORT: z.coerce.number().int().positive().optional(),
  POSTGRES_ADMIN_USER: z.string().optional(),
  POSTGRES_ADMIN_PASSWORD: z.string().optional(),
  POSTGRES_ADMIN_DB: z.string().optional(),

  ELASTICSEARCH_HOST: requiredString,
  ELASTICSEARCH_USER: requiredString,
  ELASTICSEARCH_PASSWORD: requiredString,
  ELASTICSEARCH_INDEX: z.string().optional(),
  ELASTICSEARCH_ADMIN_USER: z.string().optional(),
  ELASTICSEARCH_ADMIN_PASSWORD: emptyToUndefined,

  BETTER_AUTH_SECRET: requiredString,
  ALLOWED_WEBSITE_URLS: z.string().default(''),
  BASE_URL: requiredString,
  USERNAME_API_NADEDB: requiredString,
  EMAIL_API_NADEDB: requiredString,
  API_KEY_MASTER: requiredString,

  API_KEY_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(300000),
  API_KEY_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(2000),

  ID_OAUTH_GOOGLE: emptyToUndefined,
  SECRET_OAUTH_GOOGLE: emptyToUndefined,
  DISCORD_CLIENT_ID: emptyToUndefined,
  DISCORD_CLIENT_SECRET: emptyToUndefined,

  SES_AWS_REGION: emptyToUndefined,
  SES_AWS_ACCESS_KEY_ID: emptyToUndefined,
  SES_AWS_SECRET_ACCESS_KEY: emptyToUndefined,
  SES_FROM_EMAIL: z.string().default('noreply@nadeshiko.co'),
  SES_FROM_NAME: z.string().default('Nadeshiko'),

  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().optional(),
  OTEL_SERVICE_NAME: z.string().optional(),

  LOG_LEVEL: z.string().optional(),
  DB_LOG_LEVEL: z.string().optional(),
  NODE_ENV: z.string().optional(),
  DATABASE_URL: z.string().optional(),
});

export const config: Readonly<z.infer<typeof envSchema>> = Object.freeze(envSchema.parse(process.env));
export type AppConfig = z.infer<typeof envSchema>;
