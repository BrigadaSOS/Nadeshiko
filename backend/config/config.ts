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
  // Injected by Kamal from VERSION. Exposed only through /up so release gates
  // can prove the exact image they asked for is the one answering traffic.
  RELEASE_SHA: z.string().trim().default('unknown'),
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
  // How many parse batches run at once. See the long note on PARSE_CONCURRENCY in
  // app/services/shirabe/parseSegments.ts for why the default is deliberately
  // small. Validated here rather than read raw so a typo is a boot error instead
  // of a silent fallback to the default.
  SHIRABE_PARSE_CONCURRENCY: z.coerce.number().int().positive().default(3),
  // Shirabe linking is off unless client registration and the encrypted connection secret are configured; never replace
  // the secret with cleartext third-party credentials.
  SHIRABE_OAUTH_CLIENT_ID: z.string().default('nadeshiko'),
  SHIRABE_OAUTH_REDIRECT_URI: z.string().default(''),
  /** This is a confidential Shirabe client: the secret must be sent on token exchange/renewal/revocation, and empty
   * disables linking. */
  SHIRABE_OAUTH_CLIENT_SECRET: z.string().default(''),
  /** Require generated key material when configured; a short value still derives a valid-looking but guessable key,
   * so empty is the only disabled state. */
  SHIRABE_CONNECTION_SECRET: z
    .string()
    .default('')
    .refine((value) => value === '' || value.length >= 32, {
      message:
        'SHIRABE_CONNECTION_SECRET must be at least 32 characters of generated key material (or empty to disable linking)',
    }),
  /** The previous Shirabe secret is read-only during rotation; configure it while re-encrypting stored rows, then
   * clear it. */
  SHIRABE_CONNECTION_SECRET_PREVIOUS: z.string().default(''),

  // Patreon is a connected account, not a sign-in provider. Its membership is
  // what unlocks roadmap proposals, so tokens stay server-side and encrypted.
  PATREON_OAUTH_CLIENT_ID: z.string().default(''),
  PATREON_OAUTH_CLIENT_SECRET: z.string().default(''),
  PATREON_OAUTH_REDIRECT_URI: z.string().default(''),
  PATREON_CAMPAIGN_ID: z.string().default(''),
  PATREON_CAMPAIGN_URL: z.string().url().default('https://www.patreon.com/c/BrigadaSOS'),
  PATREON_CONNECTION_SECRET: z
    .string()
    .default('')
    .refine((value) => value === '' || value.length >= 32, {
      message: 'PATREON_CONNECTION_SECRET must be at least 32 characters (or empty to disable linking)',
    }),

  API_KEY_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60000),
  API_KEY_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(150),

  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  RATE_LIMIT_MAX_REQUESTS_PER_IP: z.coerce.number().int().positive().default(300),
  RATE_LIMIT_AUTH_MAX_REQUESTS_PER_IP: z.coerce.number().int().positive().default(60),
  // Feedback is unauthenticated and sends mail, so it gets its own much smaller
  // budget than the general one. Nobody has more than a handful of things to say
  // in a minute, and anyone who does can say them in one message.
  RATE_LIMIT_FEEDBACK_MAX_REQUESTS_PER_IP: z.coerce.number().int().positive().default(5),

  // Cap concurrent searches, not request rate, as the backend half of admission control for direct API callers the
  // frontend cannot see.
  SEARCH_MAX_INFLIGHT: z.coerce.number().int().positive().default(32),

  // The internal proxy secret exempts only authenticated frontend-proxy traffic from the backend IP limit; unset must
  // fail safe and limit everything.
  INTERNAL_PROXY_SECRET: optionalString,

  // Salt the pseudonymous access-log hash or omit it; rotating the salt intentionally breaks joins to older lines while
  // preserving aggregate usefulness.
  LOG_USER_SALT: optionalString,

  ID_OAUTH_GOOGLE: optionalString,
  SECRET_OAUTH_GOOGLE: optionalString,
  DISCORD_CLIENT_ID: optionalString,
  DISCORD_CLIENT_SECRET: optionalString,

  E2E_USER_PASSWORD: optionalString,

  // Who transactional mail comes from. Required, because a message with no
  // From is not a message.
  MAIL_FROM_EMAIL: requiredString,
  MAIL_FROM_NAME: requiredString,

  // Lifecycle mail uses a readable, real inbox rather than `noreply`; default it so templates do not promise replies to
  // an unwatched address. Replies follow From because no Reply-To is set.
  LIFECYCLE_FROM_EMAIL: z.string().default('hello@nadeshiko.co'),
  LIFECYCLE_FROM_NAME: z.string().default('Nadeshiko'),

  // The lifecycle switch defaults off and dry-runs selection without enqueueing or claiming rows, so enabling later
  // does not find every account already marked sent.
  LIFECYCLE_EMAILS_ENABLED: booleanString,

  // A staging recipient list permits real inbox/link checks while all other candidates remain dry-run; unset means
  // everyone only after the master switch is enabled.
  LIFECYCLE_EMAILS_ONLY_TO: optionalString,

  // Use ZeptoMail HTTP API rather than synchronous SMTP; retain legacy token names for SSM compatibility, with
  // `ZEPTOMAIL_SEND_TOKEN` taking precedence.
  SMTP_ADDRESS: optionalString,
  SMTP_PORT: optionalString,
  SMTP_USER_NAME: optionalString,
  SMTP_PASSWORD: optionalString,

  // Set only if the Send Mail Token ever stops doubling as the API key, so that
  // becomes a configuration change rather than a deploy of the mailer.
  ZEPTOMAIL_SEND_TOKEN: optionalString,

  // An optional second ZeptoMail agent isolates lifecycle policy from sign-in mail; unset preserves current behavior,
  // but domain-level DKIM reputation remains shared until lifecycle mail moves domains.
  ZEPTOMAIL_LIFECYCLE_SEND_TOKEN: optionalString,

  // Without the webhook secret, reject all ZeptoMail callbacks rather than trust forged bounces; local/test runs
  // intentionally leave it unset.
  ZEPTOMAIL_WEBHOOK_SECRET: optionalString,

  // Zoho OAuth clears the provider’s suppression list during a lift; absent credentials still support clearing the
  // local half and reporting the provider half was not changed.
  ZOHO_CLIENT_ID: optionalString,
  ZOHO_CLIENT_SECRET: optionalString,
  ZOHO_REFRESH_TOKEN: optionalString,
  // Zoho's hosts are per data centre and must match the region the Agent and the
  // OAuth client were registered in. Ours is Japan, like the SMTP relay.
  ZOHO_ACCOUNTS_HOST: z.string().default('accounts.zoho.jp'),
  ZEPTOMAIL_API_HOST: z.string().default('api.zeptomail.jp'),

  // Where the feedback widget's messages land. Optional, and unset means the
  // notification is skipped, not that the feature is off: the row is stored
  // either way, so a missing address costs the email and nothing else. Local and
  // test runs therefore need no configuration.
  FEEDBACK_NOTIFICATION_TO: optionalString,

  OTEL_EXPORTER_OTLP_ENDPOINT: optionalString,
  OTEL_SERVICE_NAME: optionalString,

  // The server-side PostHog key only submits events; unset disables capture so local/test send nothing.
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
