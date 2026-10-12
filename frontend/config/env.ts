import { z } from 'zod/v4';

const optionalString = z
  .string()
  .optional()
  .transform((value) => {
    const trimmed = value?.trim();
    return trimmed ? trimmed : undefined;
  });

const envSchema = z.object({
  NUXT_RELEASE_SHA: z.string().trim().default('unknown'),
  NUXT_PUBLIC_ENVIRONMENT: z.preprocess(
    (val) => (val === '' ? undefined : val),
    z.enum(['local', 'development', 'production']).default('production'),
  ),
  NUXT_BACKEND_INTERNAL_URL: z.string().trim().default(''),
  NUXT_NADESHIKO_API_KEY: z.string().trim().default(''),
  // Server-only definition lookup key, distinct from the backend's corpus parsing key.
  NUXT_SHIRABE_API_KEY: z.string().trim().default(''),
  NUXT_SHIRABE_API_BASE: z.string().trim().default('https://shirabe.org'),
  // Public reader settings URL; independent of the server API address and contains no key.
  NUXT_PUBLIC_SHIRABE_SITE: z.string().trim().default('https://shirabe.org'),
  // Optional direct endpoint tried before the public fallback; unset uses only the public API.
  NUXT_SHIRABE_API_DIRECT: z.string().trim().default(''),
  // Exempts proxied backend requests from its per-IP limiter; match INTERNAL_PROXY_SECRET.
  NUXT_INTERNAL_PROXY_SECRET: z.string().trim().default(''),
  // E2E bypass for HTML and /v1 IP limits and SSR admission; prevents throttling
  // from masquerading as feature failures. Empty disables it; never set in production.
  NUXT_RATE_LIMIT_BYPASS_SECRET: z.string().trim().default(''),
  NUXT_BACKEND_HOST_HEADER: optionalString,
  NUXT_MEDIA_FILES_PATH: optionalString,
  // Persist old /_nuxt/* assets across deploys for open tabs (assetArchive.ts).
  // Use a mounted path outside the image; empty disables the archive in dev/CI.
  NUXT_ASSET_ARCHIVE_DIR: z.string().trim().default(''),
  NUXT_SITEMAP_SNAPSHOT_DIR: z.string().trim().default(''),
  // Retention days vary with deploy frequency; see ASSET_ARCHIVE_RETENTION_DAYS.
  NUXT_ASSET_ARCHIVE_DAYS: z.coerce.number().int().positive().default(30),
  NUXT_RATE_LIMIT_V1_AUTH_MAX: z.coerce.number().int().positive().default(30),
  NUXT_RATE_LIMIT_V1_API_MAX: z.coerce.number().int().positive().default(120),
  // Separate low budget for unauthenticated feedback writes, which each queue an email.
  NUXT_RATE_LIMIT_V1_FEEDBACK_MAX: z.coerce.number().int().positive().default(5),
  NUXT_RATE_LIMIT_HTML_MAX: z.coerce.number().int().positive().default(60),
  // Per-process SSR admission cap: excess gets 503. Workers cannot share event-loop
  // capacity; see server/middleware/99-ssr-admission.ts for default sizing.
  NUXT_SSR_MAX_INFLIGHT: z.coerce.number().int().positive().default(8),
});

export const env: Readonly<z.infer<typeof envSchema>> = Object.freeze(envSchema.parse(process.env));
