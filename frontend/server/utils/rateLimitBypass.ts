// Allow the known E2E runner to bypass per-IP limits without changing staging budgets. No secret means no bypass.
export function presentsBypassSecret(offered: string | undefined, expected: string): boolean {
  if (!expected) return false;
  if (offered === undefined) return false;

  // Compare all same-length characters. The fixed generated secret length is not confidential.
  if (offered.length !== expected.length) return false;

  let differs = 0;
  for (let i = 0; i < expected.length; i++) {
    differs |= offered.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return differs === 0;
}

export const RATE_LIMIT_BYPASS_HEADER = 'x-rate-limit-bypass';
