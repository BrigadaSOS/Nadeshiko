/**
 * Whether a caller may skip the per-IP HTML limiter.
 *
 * WHY THIS EXISTS. The end-to-end suite runs ~140 tests from ONE address -- a
 * single CI runner -- against a limiter that allows 60 renders a minute. It does
 * not fit, and running out did not fail honestly: the next request 429d wherever
 * it happened to land, so each run reported an unrelated failure somewhere new.
 * It spent a while masking the anonymous-access check in collections.spec.ts,
 * which asserts a 302 and was being handed a 429 -- a security regression test
 * that could no longer fail for the right reason.
 *
 * The alternative was raising the limit on staging, which would have meant the
 * environment we rehearse on no longer throttles like the one we ship to. A
 * bypass one known caller holds keeps the limiter identical in both.
 *
 * NO SECRET, NO BYPASS. `expected` empty means the door does not exist, which is
 * the state production is in: the parameter is only set on staging, and
 * `deploy.prod.yml` does not carry the variable at all.
 */
export function presentsBypassSecret(offered: string | undefined, expected: string): boolean {
  if (!expected) return false;
  if (offered === undefined) return false;

  // Constant time. This is a bearer secret arriving on an unauthenticated
  // request, so an early return on the first differing byte leaks it to anyone
  // willing to time the responses -- a few thousand requests per character.
  //
  // Length is compared first and separately, which does leak the LENGTH. That is
  // deliberate and harmless here: the secret is a generated 32 bytes, its length
  // is fixed and not a secret, and the alternative (hashing both sides to a
  // fixed width) buys nothing against an attacker who can read this file.
  if (offered.length !== expected.length) return false;

  let differs = 0;
  for (let i = 0; i < expected.length; i++) {
    differs |= offered.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return differs === 0;
}

/** The header the suite sends it on. */
export const RATE_LIMIT_BYPASS_HEADER = 'x-rate-limit-bypass';
