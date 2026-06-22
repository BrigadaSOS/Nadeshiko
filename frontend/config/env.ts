import { z } from 'zod/v4';

const optionalString = z
  .string()
  .optional()
  .transform((value) => {
    const trimmed = value?.trim();
    return trimmed ? trimmed : undefined;
  });

const envSchema = z.object({
  NUXT_PUBLIC_ENVIRONMENT: z.preprocess(
    (val) => (val === '' ? undefined : val),
    z.enum(['local', 'development', 'production']).default('production'),
  ),
  NUXT_PUBLIC_FARO_URL: optionalString,
  NUXT_PUBLIC_FARO_APP_NAME: optionalString,
  NUXT_BACKEND_INTERNAL_URL: z.string().trim().default(''),
  NUXT_NADESHIKO_API_KEY: z.string().trim().default(''),
  // Shared secret sent to the backend on every proxied request so its per-IP
  // rate limiter can recognise (and exempt) traffic coming through this proxy.
  // Must match the backend's INTERNAL_PROXY_SECRET.
  NUXT_INTERNAL_PROXY_SECRET: z.string().trim().default(''),
  NUXT_BACKEND_HOST_HEADER: optionalString,
  NUXT_MEDIA_FILES_PATH: optionalString,
  NUXT_FALLBACK_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60000),
  NUXT_FALLBACK_RATE_LIMIT_MAX_REQUESTS: z.coerce.number().int().positive().default(300),
  NUXT_RATE_LIMIT_V1_AUTH_MAX: z.coerce.number().int().positive().default(30),
  NUXT_RATE_LIMIT_V1_API_MAX: z.coerce.number().int().positive().default(120),
  NUXT_RATE_LIMIT_HTML_MAX: z.coerce.number().int().positive().default(60),
});

export const env: Readonly<z.infer<typeof envSchema>> = Object.freeze(envSchema.parse(process.env));
