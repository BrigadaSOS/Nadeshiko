import crypto from 'node:crypto';
import { config } from '@config/config';

/** Accept the configured static-header proof or a valid HMAC: provider console and documentation use different
 * schemes. Reject requests with neither. */

/**
 * The authorization header configured on the Agent's webhook. Changing it means
 * changing it in the ZeptoMail console in the same breath.
 */
export const TOKEN_HEADER = 'x-nadeshiko-webhook-token';

export const SIGNATURE_HEADER = 'producer-signature';

/** Read the secret through a function because frozen module config is not a test seam; do not mutate config inside a
 * hook. */
export function getWebhookSecret(): string | undefined {
  return config.ZEPTOMAIL_WEBHOOK_SECRET;
}

/** Reject signed payloads outside the freshness window; otherwise a captured bounce could be replayed to suppress an
 * address forever. */
const TOLERANCE_MS = 5 * 60 * 1000;

/** Accept both form-encoded and plain JSON bodies, but return the exact JSON text covered by the HMAC. */
export function extractPayload(rawBody: string): string {
  const trimmed = rawBody.trim();
  if (!trimmed.startsWith('data=')) return trimmed;

  // Split `data=` at the first `=`; encoded JSON and embedded values may contain further equals signs.
  const value = trimmed.slice('data='.length);
  try {
    return decodeURIComponent(value.replace(/\+/g, ' '));
  } catch {
    return value;
  }
}

/** Compare fixed-width digests because `timingSafeEqual` throws on unequal lengths; do not expose length through the
 * comparison path. */
function secureEquals(a: string, b: string): boolean {
  const digestA = crypto.createHash('sha256').update(a).digest();
  const digestB = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(digestA, digestB);
}

export function tokenMatches(provided: string | undefined, secret: string): boolean {
  if (!provided) return false;
  return secureEquals(provided, secret);
}

/** Parse documented separator variants leniently, then verify the HMAC strictly. */
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

  // Verify the timestamp-prefixed HMAC when `ts` exists, while accepting console deliveries that omit `ts`.
  const candidates = timestamp ? [`${timestamp}.${params.payload}`, params.payload] : [params.payload];

  return candidates.some((candidate) => {
    const expected = crypto.createHmac('sha256', params.secret).update(candidate).digest('base64');
    return secureEquals(expected, signature);
  });
}
