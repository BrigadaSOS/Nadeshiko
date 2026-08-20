import crypto from 'node:crypto';
import { config } from '@config/config';

/**
 * Proving a ZeptoMail webhook is really from ZeptoMail.
 *
 * TWO WAYS IN, because ZeptoMail's documentation and its own console disagree
 * about how a webhook proves who sent it. The console offers a static
 * authorization header, name and value of your choosing, which is what is
 * actually configured on the Agent; the docs describe an HMAC
 * `producer-signature`. Either satisfies us, both use the same secret, and
 * neither being present is a refusal.
 *
 * Betting on the documented one alone would refuse every real delivery. Shirabe
 * found this out by shipping it.
 */

/**
 * The authorization header configured on the Agent's webhook. Changing it means
 * changing it in the ZeptoMail console in the same breath.
 */
export const TOKEN_HEADER = 'x-nadeshiko-webhook-token';

export const SIGNATURE_HEADER = 'producer-signature';

/**
 * The shared secret both authentication paths are keyed on.
 *
 * Read through a function rather than off `config` at the call site because
 * `config` is frozen at module load: a test that needs a configured endpoint
 * cannot assign one, and assigning anyway throws inside a hook and leaves the
 * suite's transaction open. This is the seam tests stub instead.
 */
export function getWebhookSecret(): string | undefined {
  return config.ZEPTOMAIL_WEBHOOK_SECRET;
}

/**
 * How stale a signed payload may be. A signature with no freshness check is a
 * replay waiting to happen: a captured hard-bounce delivery could be resent
 * forever to suppress an address on demand.
 */
const TOLERANCE_MS = 5 * 60 * 1000;

/**
 * ZeptoMail's docs describe a form-encoded body, `data=<urlencoded JSON>`; the
 * console posts plain JSON. Accept both, and return the JSON text either way --
 * which is also the exact string the HMAC covers.
 */
export function extractPayload(rawBody: string): string {
  const trimmed = rawBody.trim();
  if (!trimmed.startsWith('data=')) return trimmed;

  // Only the FIRST `=` separates the key from the value: the urlencoded JSON
  // that follows contains `=` of its own inside base64 and query strings, and
  // splitting on all of them truncates the payload to something unparseable.
  const value = trimmed.slice('data='.length);
  try {
    return decodeURIComponent(value.replace(/\+/g, ' '));
  } catch {
    return value;
  }
}

/**
 * Length-safe compare. `crypto.timingSafeEqual` throws on a length mismatch
 * rather than returning false, and the throw itself leaks the length, so the
 * comparison is done over fixed-width digests of both sides.
 */
function secureEquals(a: string, b: string): boolean {
  const digestA = crypto.createHash('sha256').update(a).digest();
  const digestB = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(digestA, digestB);
}

export function tokenMatches(provided: string | undefined, secret: string): boolean {
  if (!provided) return false;
  return secureEquals(provided, secret);
}

/**
 * `producer-signature` is `ts=<milliseconds>;sig=<base64 HMAC-SHA256>` in the
 * documented form, though the docs are not consistent about the separator. Parse
 * leniently, verify strictly.
 */
export function signatureValid(params: {
  header: string | undefined;
  payload: string;
  secret: string;
  now?: number;
}): boolean {
  if (!params.header) return false;

  const parts = params.header.split(/[;,&]/).map((part) => part.trim());
  let timestamp: string | null = null;
  let signature: string | null = null;

  for (const part of parts) {
    const [key, ...rest] = part.split('=');
    const value = rest.join('=');
    if (!value) {
      // A bare value with no `key=` is the signature on its own, which is how
      // some of ZeptoMail's examples show it.
      if (!signature) signature = part;
      continue;
    }
    if (key === 'ts') timestamp = value;
    else if (key === 'sig' || key === 'signature') signature = value;
  }

  if (!signature) return false;

  if (timestamp) {
    const sentAt = Number(timestamp);
    if (!Number.isFinite(sentAt)) return false;
    const age = Math.abs((params.now ?? Date.now()) - sentAt);
    if (age > TOLERANCE_MS) return false;
  }

  // The HMAC covers the payload with the timestamp prefixed when one is present,
  // which is the shape every Zoho example that includes `ts` uses. Both are
  // accepted because the console's own deliveries have arrived without a `ts`.
  const candidates = timestamp ? [`${timestamp}.${params.payload}`, params.payload] : [params.payload];

  return candidates.some((candidate) => {
    const expected = crypto.createHmac('sha256', params.secret).update(candidate).digest('base64');
    return secureEquals(expected, signature);
  });
}
