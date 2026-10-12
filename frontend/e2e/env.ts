export function getE2EBaseUrl(fallback?: string): string {
  const baseUrl = process.env.E2E_BASE_URL || process.env.BASE_URL || fallback;

  if (!baseUrl) {
    throw new Error('E2E_BASE_URL or BASE_URL must be set (loaded from backend/.env)');
  }

  return baseUrl;
}

// Independent, optional bypasses: x-rate-limit-bypass passes the origin HTML limiter
// (frontend/server/utils/ipRateLimit.ts); x-nadeshiko-ci passes Cloudflare's skip_ci_e2e
// rule (brigadasos-infra/terraform/cloudflare-security.tf). One cannot replace the other.
// Without each secret, requests remain subject to that layer's throttling/challenges.
export function e2eBypassHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};

  const rateLimitSecret = process.env.E2E_RATE_LIMIT_BYPASS_SECRET;
  if (rateLimitSecret) headers['x-rate-limit-bypass'] = rateLimitSecret;

  const wafSecret = process.env.E2E_CI_BYPASS_SECRET;
  if (wafSecret) headers['x-nadeshiko-ci'] = wafSecret;

  return headers;
}
