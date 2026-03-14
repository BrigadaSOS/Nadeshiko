import { z } from 'zod/v4';

const optionalString = z
  .string()
  .optional()
  .transform((value) => {
    const trimmed = value?.trim();
    return trimmed ? trimmed : undefined;
  });

const requiredString = z.string().trim().min(1);

const envSchema = z.object({
  NUXT_PUBLIC_ENVIRONMENT: z.enum(['local', 'dev', 'prod']).default('prod'),
  NUXT_BACKEND_INTERNAL_URL: z.string().trim().default(''),
  NUXT_NADESHIKO_API_KEY: z.string().trim().default(''),
  NUXT_BACKEND_HOST_HEADER: optionalString,
  NUXT_MEDIA_FILES_PATH: optionalString,
  NUXT_FALLBACK_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60000),
  NUXT_FALLBACK_RATE_LIMIT_MAX_REQUESTS: z.coerce.number().int().positive().default(300),
  SENTRY_FRONTEND_DSN: optionalString,
});

export const env: Readonly<z.infer<typeof envSchema>> = Object.freeze(envSchema.parse(process.env));

