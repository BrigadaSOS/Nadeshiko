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
  // Shirabe parses the corpus and serves the definitions behind every word. The
  // key is a service identity of ours, so it is read server-side only (see
  // server/api/shirabe/words/[wid].get.ts) and never lands in runtimeConfig.public.
  NUXT_SHIRABE_API_KEY: z.string().trim().default(''),
  NUXT_SHIRABE_API_BASE: z.string().trim().default('https://shirabe.org'),
  // Optional tailnet address for the same service. The public name resolves to
  // Cloudflare, so without this a lookup between two boxes in the same city
  // routes out to the edge and back. Tried first when set, with the public host
  // as the fallback, so it only ever changes how fast the answer arrives.
  NUXT_SHIRABE_API_DIRECT: z.string().trim().default(''),
  // Shared secret sent to the backend on every proxied request so its per-IP
  // rate limiter can recognise (and exempt) traffic coming through this proxy.
  // Must match the backend's INTERNAL_PROXY_SECRET.
  NUXT_INTERNAL_PROXY_SECRET: z.string().trim().default(''),
  /**
   * Lets a caller presenting this secret past the per-IP HTML limiter.
   *
   * It exists for the end-to-end suite, which runs ~140 tests from ONE GitHub
   * runner IP against a limiter that allows 60 renders a minute. The suite does
   * not fail cleanly when it runs out of budget -- it 429s at whatever assertion
   * happens to be next, so the run reads as an unrelated flake somewhere new
   * each time. It masked the anonymous-access check in collections.spec.ts,
   * which asserts a 302 and was quietly being handed a 429 instead: a security
   * regression test that could no longer fail for the right reason.
   *
   * Empty by default, so the bypass does not exist unless somebody deliberately
   * sets it on an environment. Not set in production.
   */
  NUXT_RATE_LIMIT_BYPASS_SECRET: z.string().trim().default(''),
  NUXT_BACKEND_HOST_HEADER: optionalString,
  NUXT_MEDIA_FILES_PATH: optionalString,
  NUXT_RATE_LIMIT_V1_AUTH_MAX: z.coerce.number().int().positive().default(30),
  NUXT_RATE_LIMIT_V1_API_MAX: z.coerce.number().int().positive().default(120),
  NUXT_RATE_LIMIT_HTML_MAX: z.coerce.number().int().positive().default(60),
});

export const env: Readonly<z.infer<typeof envSchema>> = Object.freeze(envSchema.parse(process.env));
