export function getE2EBaseUrl(fallback?: string): string {
  const baseUrl = process.env.E2E_BASE_URL || process.env.BASE_URL || fallback;

  if (!baseUrl) {
    throw new Error('E2E_BASE_URL or BASE_URL must be set (loaded from backend/.env)');
  }

  return baseUrl;
}

/**
 * Headers that let this suite past the two things that would otherwise stop it.
 * TWO SECRETS, TWO LAYERS, and they are not interchangeable:
 *
 *   x-rate-limit-bypass  the ORIGIN's per-IP HTML rate limiter, in
 *                        frontend/server/utils/ipRateLimit.ts.
 *   x-nadeshiko-ci       CLOUDFLARE, before the request reaches the origin at
 *                        all. Read by the `skip_ci_e2e` rule in
 *                        brigadasos-infra/terraform/cloudflare-security.tf.
 *
 * A request can be allowed by one and stopped by the other, which is why both
 * are sent rather than one being folded into the other.
 *
 * WHY THE CLOUDFLARE ONE EXISTS. On 2026-08-13 a WAF rule started issuing a
 * managed challenge on /:locale/sentence/ to fight a corpus scraper. Playwright
 * cannot pass a managed challenge, so sentence.spec.ts and the uuid redirect
 * tests began failing against prod -- a green build turning red for a reason
 * that has nothing to do with the application. The bypass rule was written for
 * exactly this and had never been switched on, because the secret it keys on
 * was empty.
 *
 * Each is empty unless the environment sets it. An unset x-rate-limit-bypass
 * means a suite pointed at prod is throttled like anybody else; an unset
 * x-nadeshiko-ci means it is challenged like anybody else.
 */
export function e2eBypassHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};

  const rateLimitSecret = process.env.E2E_RATE_LIMIT_BYPASS_SECRET;
  if (rateLimitSecret) headers['x-rate-limit-bypass'] = rateLimitSecret;

  const wafSecret = process.env.E2E_CI_BYPASS_SECRET;
  if (wafSecret) headers['x-nadeshiko-ci'] = wafSecret;

  return headers;
}
