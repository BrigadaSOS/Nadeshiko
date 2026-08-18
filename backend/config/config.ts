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
  // Shirabe parses every segment we serve and supplies the definitions behind
  // each word. The key is a quota-exempt service identity of ours.
  SHIRABE_API_BASE: z.string().url().default('https://shirabe.org'),
  SHIRABE_API_KEY: z.string().default(''),
  // A reader can also link their OWN Shirabe account, which is what makes a word
  // lookup answer from the dictionaries THEY configured rather than from the
  // service identity's empty preferences. Three separate things:
  //
  //   CLIENT_ID / REDIRECT_URI  what Shirabe has us registered as. The redirect
  //                             is exact-matched over there, so a value that does
  //                             not match the registration fails at the consent
  //                             screen rather than silently.
  //   CONNECTION_SECRET         encrypts the stored per-reader keys at rest, and
  //                             seals the OAuth `state`. Unset means the feature
  //                             is off, which is the right default: the
  //                             alternative is storing other people's
  //                             credentials in the clear.
  SHIRABE_OAUTH_CLIENT_ID: z.string().default('nadeshiko'),
  SHIRABE_OAUTH_REDIRECT_URI: z.string().default(''),
  SHIRABE_CONNECTION_SECRET: z.string().default(''),

  API_KEY_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60000),
  API_KEY_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(150),

  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  RATE_LIMIT_MAX_REQUESTS_PER_IP: z.coerce.number().int().positive().default(300),
  RATE_LIMIT_AUTH_MAX_REQUESTS_PER_IP: z.coerce.number().int().positive().default(60),
  // Feedback is unauthenticated and sends mail, so it gets its own much smaller
  // budget than the general one. Nobody has more than a handful of things to say
  // in a minute, and anyone who does can say them in one message.
  RATE_LIMIT_FEEDBACK_MAX_REQUESTS_PER_IP: z.coerce.number().int().positive().default(5),

  // Shared secret proving a request came through our own frontend Nitro proxy
  // (which already rate-limits per real client IP). When set, the per-IP
  // backend limiter exempts requests carrying it. Must match the frontend's
  // NUXT_INTERNAL_PROXY_SECRET. Left unset = no exemption (fail-safe: traffic is
  // limited, never silently bypassed).
  INTERNAL_PROXY_SECRET: optionalString,

  // Salt for the pseudonymous `user.hash` field on the HTTP access log. Left
  // unset, the field is simply absent -- an unsalted hash of an integer id is
  // no protection at all (the id space is small enough to enumerate in a
  // second), so the choice is a salted field or none, never a bare digest.
  //
  // Rotating this invalidates every prior join. That is the intended lever:
  // the field exists to answer "what has this account been calling this week",
  // and a rotation ends the ability to ask that of older lines while leaving
  // them useful for the aggregate questions.
  LOG_USER_SALT: optionalString,

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

  // Outbound transport. `ses` is the current path; `zepto` is SMTP via
  // smtp.zeptomail.jp. Staging flips this without dropping SES DNS so we can
  // roll back by flipping it back. From-address stays SES_FROM_EMAIL either way.
  MAIL_TRANSPORT: z.enum(['ses', 'zepto']).default('ses'),
  SMTP_ADDRESS: optionalString,
  SMTP_PORT: optionalString,
  SMTP_USER_NAME: optionalString,
  SMTP_PASSWORD: optionalString,

  // Where the feedback widget's messages land. Optional, and unset means the
  // notification is skipped, not that the feature is off: the row is stored
  // either way, so a missing address costs the email and nothing else. Local and
  // test runs therefore need no configuration.
  FEEDBACK_NOTIFICATION_TO: optionalString,

  OTEL_EXPORTER_OTLP_ENDPOINT: optionalString,
  OTEL_SERVICE_NAME: optionalString,

  // Server-side PostHog, which exists to count accounts that the browser never
  // gets to report -- see app/services/analytics/posthog.ts. This is the project
  // write key, not a personal API key: it can only submit events, which is why it
  // is also the one the browser ships publicly. Unset disables capture entirely,
  // so local and test runs need no credentials and send nothing.
  POSTHOG_API_KEY: optionalString,
  POSTHOG_HOST: z.string().url().default('https://us.i.posthog.com'),

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
