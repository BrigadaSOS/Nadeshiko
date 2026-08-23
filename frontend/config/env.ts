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
  // The browser-metrics receiver the RUM reporter posts web vitals to. Absent
  // outside production and staging, which is what stops a local run from
  // beaconing at the collector.
  NUXT_PUBLIC_BROWSER_METRICS_URL: optionalString,
  NUXT_PUBLIC_BROWSER_APP_NAME: optionalString,
  NUXT_BACKEND_INTERNAL_URL: z.string().trim().default(''),
  NUXT_NADESHIKO_API_KEY: z.string().trim().default(''),
  // Shirabe parses the corpus and serves the definitions behind every word. The
  // key is a service identity of ours, so it is read server-side only (see
  // server/api/shirabe/words/[wid].get.ts) and never lands in runtimeConfig.public.
  NUXT_SHIRABE_API_KEY: z.string().trim().default(''),
  NUXT_SHIRABE_API_BASE: z.string().trim().default('https://shirabe.org'),
  // Where a READER is sent to change their Shirabe settings, which is not the
  // same address our server calls: that one may be a tailnet host nobody can
  // browse to. Public, and no key is involved.
  NUXT_PUBLIC_SHIRABE_SITE: z.string().trim().default('https://shirabe.org'),
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
  /**
   * Where superseded builds' `/_nuxt/*` files are kept so a deploy does not
   * break the pages readers already have open. See server/utils/assetArchive.ts.
   *
   * A path OUTSIDE the image, or this does nothing: the point is to outlive the
   * container. In production it is the volume mounted in config/deploy.prod.yml.
   * Empty -- the default, and what dev and CI get -- turns the archive off
   * entirely rather than degrading it.
   */
  NUXT_ASSET_ARCHIVE_DIR: z.string().trim().default(''),
  /**
   * How long a superseded build's assets stay servable, in days.
   *
   * Per environment because the deploy rates are not comparable: production
   * releases 5-12 times a month, staging on every push to main. See
   * ASSET_ARCHIVE_RETENTION_DAYS for the reasoning behind the default.
   */
  NUXT_ASSET_ARCHIVE_DAYS: z.coerce.number().int().positive().default(30),
  NUXT_RATE_LIMIT_V1_AUTH_MAX: z.coerce.number().int().positive().default(30),
  NUXT_RATE_LIMIT_V1_API_MAX: z.coerce.number().int().positive().default(120),
  /**
   * The feedback widget, which is the only unauthenticated WRITE the proxy
   * forwards. Deliberately far below the general budget: sending feedback is not
   * something a person does in a burst, and each submission costs an email.
   */
  NUXT_RATE_LIMIT_V1_FEEDBACK_MAX: z.coerce.number().int().positive().default(5),
  NUXT_RATE_LIMIT_HTML_MAX: z.coerce.number().int().positive().default(60),
});

export const env: Readonly<z.infer<typeof envSchema>> = Object.freeze(envSchema.parse(process.env));
