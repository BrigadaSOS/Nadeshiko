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
  /**
   * We are a CONFIDENTIAL client over there: a server that can keep a secret,
   * and so must present it at the token endpoint on every exchange, renewal and
   * revocation. Minted once by `bin/rails oauth_clients:register ...
   * CONFIDENTIAL=1` on Shirabe and shown once; only its digest lives there.
   * Empty means we would be refused as a client, so linking is off.
   */
  SHIRABE_OAUTH_CLIENT_SECRET: z.string().default(''),
  /**
   * Key material, not a passphrase.
   *
   * Empty means the connection feature is off, which is a real deployment and
   * the reason this is not simply required. Anything else has to be long enough
   * to be a generated secret: `secretBox` derives a 32-byte key from whatever it
   * is given, so a four-character value produces a perfectly valid-looking key
   * that is trivially guessable, and nothing downstream can tell the difference.
   */
  SHIRABE_CONNECTION_SECRET: z
    .string()
    .default('')
    .refine((value) => value === '' || value.length >= 32, {
      message:
        'SHIRABE_CONNECTION_SECRET must be at least 32 characters of generated key material (or empty to disable linking)',
    }),
  /**
   * The key being rotated OUT, read but never written.
   *
   * Set it to the outgoing value while re-encrypting, and stored rows keep
   * opening under it because each carries the id of the key that sealed it.
   * Empty the rest of the time, which is almost always.
   */
  SHIRABE_CONNECTION_SECRET_PREVIOUS: z.string().default(''),

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

  // Who transactional mail comes from. Required, because a message with no
  // From is not a message.
  MAIL_FROM_EMAIL: requiredString,
  MAIL_FROM_NAME: requiredString,

  // Who the LIFECYCLE mail comes from, which is deliberately not the same
  // person as the above.
  //
  // The day-7 note, the feedback ask and the recap are written in the first
  // person and ask to be replied to. Sending those from `noreply@` makes the
  // email a lie the moment somebody answers it, and "we would love to hear from
  // you, from an address that discards your reply" is worse than not asking.
  //
  // DEFAULTED RATHER THAN REQUIRED, because the failure mode of an unset value
  // is silent: the mail still sends, still says "reply to me", and still goes
  // out from an address nobody reads. A default means the promise in the
  // template holds even in an environment where nobody set this.
  //
  // Any address on the ZeptoMail-verified domain works; the DKIM signature is
  // per-domain, not per-mailbox. It does still need to exist as a real inbox --
  // that is the entire point of it.
  // The envelope on every lifecycle and welcome email, for every reader. It was
  // one of the founders' own mailboxes and is a shared identity now; the body
  // still carries the individual, taken from `senderForUser` at the call site.
  // Replies follow the From, since these messages set no Reply-To, so this
  // address has to be a mailbox somebody reads.
  LIFECYCLE_FROM_EMAIL: z.string().default('hello@nadeshiko.co'),
  LIFECYCLE_FROM_NAME: z.string().default('Nadeshiko'),

  // THE MASTER SWITCH FOR LIFECYCLE MAIL, and it is off.
  //
  // Off does not mean the sweep stops. It runs every night, selects exactly the
  // accounts it would write to, and logs what it would have sent -- so the
  // candidate counts can be read off production for a week before anybody
  // decides to turn this on. What it does not do is enqueue anything, and,
  // just as importantly, it does not write the `EmailLifecycleSend` claim rows:
  // a dry run that claimed would mark every swept account as already-done, and
  // the day this was enabled it would send to nobody and look like it worked.
  //
  // Default false rather than true-in-development, because "which environment
  // is this" is the wrong question. The right one is "has a person read the copy
  // and decided", and that has exactly one answer until they have.
  LIFECYCLE_EMAILS_ENABLED: booleanString,

  // A staging post between off and everyone: when set, only these addresses get
  // a real send and every other candidate stays a dry run. Comma-separated.
  //
  // For seeing the mail arrive in a real inbox, rendered by a real client, with
  // real links -- which is the one thing `npm run email:test` cannot show you.
  // Leave it unset to mean "everybody", which only takes effect once the switch
  // above is on.
  LIFECYCLE_EMAILS_ONLY_TO: optionalString,

  // Outbound is ZeptoMail SMTP, and only that. There is no MAIL_TRANSPORT
  // switch any more: the `ses` branch existed as the rollback path for the
  // cutover, and a rollback path nobody has exercised in months is not a safety
  // net, it is a second sending identity with its own DKIM records and its own
  // unwatched reputation.
  // Outbound goes over the ZeptoMail HTTP API, not SMTP. The SMTP handoff cost
  // FOUR TO SIX SECONDS per message on production -- a fresh TLS-and-AUTH
  // conversation with a relay in Tokyo, roughly ten round trips -- and the
  // magic-link path pays that synchronously while somebody watches a button.
  //
  // `SMTP_PASSWORD` is still the credential: ZeptoMail's Send Mail Token is the
  // SMTP password AND the API key. The name is now wrong and is kept anyway,
  // because renaming it means renaming an SSM parameter in two tiers to save a
  // word. The others are vestigial and read by nothing.
  SMTP_ADDRESS: optionalString,
  SMTP_PORT: optionalString,
  SMTP_USER_NAME: optionalString,
  SMTP_PASSWORD: optionalString,

  // Set only if the Send Mail Token ever stops doubling as the API key, so that
  // becomes a configuration change rather than a deploy of the mailer.
  ZEPTOMAIL_SEND_TOKEN: optionalString,

  // A SECOND AGENT FOR LIFECYCLE MAIL, and it is unset on purpose.
  //
  // Everything currently leaves through one ZeptoMail Agent: sign-in links and
  // the day-7 ask and the win-back note all share one sending identity. That is
  // fine at seven messages a night and stops being fine the moment a recurring
  // recap joins them -- a policy action against the recap would take magic links
  // with it, and losing those means losing sign-in.
  //
  // Set this to a second Agent's token and every lifecycle kind moves to it,
  // leaving transactional mail where it is. Left unset it falls back to
  // `ZEPTOMAIL_SEND_TOKEN`, so today's behaviour is unchanged and the split is a
  // config change rather than a deploy of the mailer.
  //
  // The Agent is only half of it. DKIM is signed per DOMAIN, so reputation stays
  // shared until lifecycle mail also moves to its own subdomain -- which is the
  // point of doing this before the recap rather than after.
  ZEPTOMAIL_LIFECYCLE_SEND_TOKEN: optionalString,

  // Proves that a bounce notification really came from ZeptoMail.
  //
  // Optional in the schema but not optional in effect: without it
  // /v1/webhooks/zeptomail answers 503 to everything rather than trusting an
  // unsigned payload, because a forged hard bounce suppresses an address and
  // locks somebody out of magic-link sign-in. Unset is the correct state for
  // local and test runs, which have no Agent posting to them.
  ZEPTOMAIL_WEBHOOK_SECRET: optionalString,

  // Zoho OAuth, used for exactly one call: removing an address from ZeptoMail's
  // OWN suppression list. Auto-suppression is on at the Agent, so forgiving an
  // address means clearing two lists; deleting only our row leaves the app
  // believing it can write to somebody the relay still refuses. Absent is a
  // supported state -- the lift then does our half and says so.
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
