export function getE2EBaseUrl(fallback?: string): string {
  const baseUrl = process.env.E2E_BASE_URL || process.env.BASE_URL || fallback;

  if (!baseUrl) {
    throw new Error('E2E_BASE_URL or BASE_URL must be set (loaded from backend/.env)');
  }

  return baseUrl;
}

/**
 * Header that lets this suite past the per-IP HTML rate limiter.
 *
 * The whole run comes from one address -- a single GitHub runner -- against a
 * limiter that allows 60 renders a minute, and ~140 tests do not fit in that.
 * Running out did not fail honestly: the next request 429d wherever it landed,
 * so the run reported an unrelated failure in a different place each time. It
 * spent a while masking the anonymous-access check in collections.spec.ts, which
 * asserts a 302 and was being handed a 429 -- a security regression test that
 * could no longer fail for the right reason.
 *
 * Empty unless the environment sets it, and it is not set in production, so a
 * suite pointed at prod is throttled exactly like anybody else.
 */
export function e2eBypassHeaders(): Record<string, string> {
  const secret = process.env.E2E_RATE_LIMIT_BYPASS_SECRET;
  return secret ? { 'x-rate-limit-bypass': secret } : {};
}
