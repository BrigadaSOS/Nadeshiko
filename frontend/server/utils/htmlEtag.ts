import { createHash } from 'node:crypto';

// Weak HTML validator: elide per-render tokens, not content, so unchanged pages revalidate despite fresh nonces.
// Hashing the body accounts for identity, locale and preferences. Only non-shared HTML may use this validator;
// see 04-html-conditional-get for CSP constraints on 304 responses.

// Nitro does not emit NUL, so rendered content cannot collide with an elided token's placeholder.
const ELIDED = '\u0000';

// The SEO render-start timestamp changes on every render and must not defeat content revalidation.
const TIME_SSR_START_RE = /("timeSsrStart":)\d+/g;

// Refuse short nonces: globally replacing a one- or two-character string would shred document content.
const MIN_NONCE_LEN = 8;

export function canonicalizeHtml(body: string, nonce?: string): string {
  const withoutNonce = nonce && nonce.length >= MIN_NONCE_LEN ? body.split(nonce).join(ELIDED) : body;
  return withoutNonce.replace(TIME_SSR_START_RE, `$1${ELIDED}`);
}

// 128 bits suffice for versions of one URL held by a browser; truncation keeps validators small.
export function htmlEtag(body: string, nonce?: string): string {
  const digest = createHash('sha256').update(canonicalizeHtml(body, nonce)).digest('base64url').slice(0, 22);
  return `W/"${digest}"`;
}

const withoutWeakPrefix = (tag: string): string => (tag.startsWith('W/') ? tag.slice(2) : tag);

// RFC 9110 weak comparison ignores W/ and accepts lists or * for revalidation.
export function ifNoneMatchSatisfied(header: string | undefined, etag: string): boolean {
  if (!header) return false;

  const target = withoutWeakPrefix(etag);
  for (const candidate of header.split(',')) {
    const trimmed = candidate.trim();
    if (trimmed === '*') return true;
    if (trimmed && withoutWeakPrefix(trimmed) === target) return true;
  }
  return false;
}
