import { describe, expect, it } from 'vitest';
import { canonicalizeHtml, htmlEtag, ifNoneMatchSatisfied } from '~~/server/utils/htmlEtag';

const NONCE_A = 'Mqzp9Yo6gNLqQsWe59jaXxlK';
const NONCE_B = 'WPgovg2EjbIVru2uKhVoobnx';

/** A page in the shape the renderer actually produces: nonce on every tag type. */
const page = (nonce: string, body = 'hello', ssrStart = 1787461381995) =>
  `<!DOCTYPE html><html><head><link nonce="${nonce}" rel="preconnect" href="https://cdn.nadeshiko.co">` +
  `<style nonce="${nonce}">.a{color:red}</style></head><body>${body}` +
  `<script nonce="${nonce}">window.__NUXT__={"timeSsrStart":${ssrStart}}</script></body></html>`;

/**
 * The ETag is what decides whether a reader is sent a 113KB document or an empty
 * 304, so both directions are failures worth catching: a digest that never
 * repeats silently costs the whole feature, and one that repeats when it should
 * not shows a reader the wrong page.
 */
describe('htmlEtag', () => {
  it('gives two renders of the same page the same ETag despite different nonces', () => {
    expect(htmlEtag(page(NONCE_A), NONCE_A)).toBe(htmlEtag(page(NONCE_B), NONCE_B));
  });

  it('ignores the SEO module timestamp, which moves on every render', () => {
    const early = htmlEtag(page(NONCE_A, 'hello', 1787461381995), NONCE_A);
    const late = htmlEtag(page(NONCE_A, 'hello', 1787461999999), NONCE_A);
    expect(early).toBe(late);
  });

  it('changes when the document changes', () => {
    // Stands in for every fork the digest has to notice -- identity, locale, a
    // preference cookie -- because all of them reach it the same way: as bytes.
    expect(htmlEtag(page(NONCE_A, 'signed out'), NONCE_A)).not.toBe(
      htmlEtag(page(NONCE_A, 'signed in as reader'), NONCE_A),
    );
  });

  it('is weak, so Cloudflare passes it through and revalidation compares weakly', () => {
    expect(htmlEtag(page(NONCE_A), NONCE_A)).toMatch(/^W\/"[A-Za-z0-9_-]{22}"$/);
  });

  it('still produces a stable ETag when the render carried no nonce', () => {
    const withoutNonce = '<html><body>no csp here</body></html>';
    expect(htmlEtag(withoutNonce)).toBe(htmlEtag(withoutNonce));
  });

  /**
   * A one- or two-character nonce would be found all over the document, and
   * `split`/`join` would replace every occurrence -- shredding the body into a
   * digest that is stable, plausible and completely unrelated to the page.
   */
  it('refuses to elide a nonce too short to be one', () => {
    expect(canonicalizeHtml('<p>abcabc</p>', 'a')).toBe('<p>abcabc</p>');
  });
});

describe('ifNoneMatchSatisfied', () => {
  const etag = 'W/"dKoFon4tr6Eet_ruYItk2g"';

  it('matches the ETag the browser was given', () => {
    expect(ifNoneMatchSatisfied(etag, etag)).toBe(true);
  });

  it('matches across the weak prefix, which the comparison must ignore', () => {
    expect(ifNoneMatchSatisfied('"dKoFon4tr6Eet_ruYItk2g"', etag)).toBe(true);
  });

  it('matches one entry in a list of stored variants', () => {
    expect(ifNoneMatchSatisfied(`W/"other", ${etag}, W/"another"`, etag)).toBe(true);
  });

  it('treats * as any stored copy', () => {
    expect(ifNoneMatchSatisfied('*', etag)).toBe(true);
  });

  it('does not match a different page', () => {
    expect(ifNoneMatchSatisfied('W/"7QJTAYiFS8mOTEay0pIuy5"', etag)).toBe(false);
  });

  it('does not match a prefix of the ETag', () => {
    expect(ifNoneMatchSatisfied('W/"dKoFon4tr6Eet_ruYItk"', etag)).toBe(false);
  });

  it('sends the full document when the browser stored nothing', () => {
    expect(ifNoneMatchSatisfied(undefined, etag)).toBe(false);
    expect(ifNoneMatchSatisfied('', etag)).toBe(false);
  });
});
