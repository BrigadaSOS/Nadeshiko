import { createHash } from 'node:crypto';

/**
 * A validator for rendered HTML, so a repeat navigation can end in a 304 with an
 * empty body instead of a second copy of the document.
 *
 * WHO THIS IS FOR. Anonymous readers already get search and sentence HTML from
 * Cloudflare's edge. A signed-in reader never does -- `visitorCacheTier` rates
 * them `personal`, so the origin sends `Cache-Control: private, no-cache` and no
 * `CDN-Cache-Control` -- and `no-cache` means "store it, but revalidate before
 * reuse". They therefore ask the origin on every navigation and, with no
 * validator on the response, get the whole document back every time: 66KB brotli
 * on `/en/search/...`, 113KB on a media page. The revalidation was already
 * happening. All that was missing was something for it to compare.
 *
 * WHY THE NONCE HAS TO BE ELIDED. `security.nonce` in nuxt.config regenerates the
 * CSP nonce per render and stamps it into every `<script>`, `<style>` and
 * `<link>`, so two renders of an unchanged page are never byte-identical and a
 * naive body hash would never match twice. Replacing the nonce value with a fixed
 * placeholder before hashing makes the digest a function of the CONTENT, which is
 * the thing the reader's stored copy is or is not still good for.
 *
 * That is also why the ETag is WEAK. `W/` is the RFC 9110 way of saying
 * "equivalent, not byte-identical", which is exactly what a nonce-elided digest
 * asserts -- a strong ETag here would be a lie. It travels better too:
 * Cloudflare rewrites a strong ETag when it compresses a response and leaves a
 * weak one alone, and `If-None-Match` uses the weak comparison function either
 * way, so nothing is given up.
 *
 * WHAT THIS DOES NOT NEED TO KNOW. Nothing here enumerates identity, locale or
 * the preference cookies in `RENDER_FORKING_PREFERENCE_COOKIES`, and that is not
 * an oversight -- the digest is taken over the rendered body, so anything that
 * changes the document changes it by construction. A reader who toggles furigana
 * gets a body with ~9KB of furigana in or out of it and therefore a different
 * digest; a reader who signs out loses the account chrome and the
 * `nd-ssr-identity-check` payload and gets a different digest. The validator is
 * derived from the answer rather than from a guess about what the question was,
 * which is the one construction that cannot fall out of date when a new cookie
 * starts forking the render.
 */

/**
 * Stands in for each per-render token. A NUL byte because Nitro never emits one
 * in a rendered document, so no page can spell the placeholder out and collide
 * with a different page whose nonce happened to be elided at that offset.
 */
const ELIDED = '\u0000';

/**
 * `timeSsrStart` is the second thing that differs between two renders of the
 * same page -- @nuxtjs/seo stamps the render's start time into the payload. It is
 * a millisecond clock, so it changes on essentially every request and would
 * defeat the digest exactly as thoroughly as the nonce does.
 */
const TIME_SSR_START_RE = /("timeSsrStart":)\d+/g;

/**
 * Short nonces are refused rather than elided. `split` on a one- or
 * two-character string would shred the document, and the digest of the shreds
 * would still look like a perfectly good ETag.
 */
const MIN_NONCE_LEN = 8;

/**
 * The document with its per-render tokens replaced, i.e. what actually gets
 * hashed. Exported for the tests, which assert on the elision rather than on a
 * digest nobody can read.
 */
export function canonicalizeHtml(body: string, nonce?: string): string {
  const withoutNonce = nonce && nonce.length >= MIN_NONCE_LEN ? body.split(nonce).join(ELIDED) : body;
  return withoutNonce.replace(TIME_SSR_START_RE, `$1${ELIDED}`);
}

/**
 * 128 bits of SHA-256, base64url. Truncated because the whole value is spent on
 * every request in both directions, and a collision here costs a reader one
 * stale page rather than a security property -- the birthday bound over the
 * handful of versions of one URL a single browser holds is not worth 22 more
 * bytes on every request.
 */
export function htmlEtag(body: string, nonce?: string): string {
  const digest = createHash('sha256').update(canonicalizeHtml(body, nonce)).digest('base64url').slice(0, 22);
  return `W/"${digest}"`;
}

const withoutWeakPrefix = (tag: string): string => (tag.startsWith('W/') ? tag.slice(2) : tag);

/**
 * Whether the reader's stored copy is the one we just rendered.
 *
 * Weak comparison, per RFC 9110: `If-None-Match` ignores the `W/` prefix, which
 * is what lets a weak ETag be used for revalidation at all. The list form
 * (`If-None-Match: "a", "b"`) is rare from a browser but is what a cache sends
 * when it holds several variants, and `*` means "any stored copy will do".
 */
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
