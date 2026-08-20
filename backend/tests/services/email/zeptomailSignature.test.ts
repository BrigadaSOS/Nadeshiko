import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import { extractPayload, signatureValid, tokenMatches } from '@app/services/email/zeptomailSignature';

const SECRET = 'a-shared-secret-value';

describe('extractPayload', () => {
  it('returns a plain JSON body unchanged', () => {
    const body = '{"event_name":"hardbounce"}';
    expect(extractPayload(body)).toBe(body);
  });

  it('decodes the form-encoded shape the documentation describes', () => {
    const json = '{"event_name":"hardbounce"}';
    expect(extractPayload(`data=${encodeURIComponent(json)}`)).toBe(json);
  });

  /**
   * The urlencoded JSON contains `=` of its own inside base64 and query strings.
   * Splitting on every `=` rather than the first truncates the payload to
   * something that will not parse, and the failure looks like a bad signature.
   */
  it('splits on the first = only, so padded base64 inside the payload survives', () => {
    const json = '{"token":"YWJjZA==","to":"a@b.co"}';
    expect(extractPayload(`data=${encodeURIComponent(json)}`)).toBe(json);
  });

  it('treats + as a space, which is what form encoding means by it', () => {
    expect(extractPayload('data=%7B%22a%22%3A%22x+y%22%7D')).toBe('{"a":"x y"}');
  });
});

describe('tokenMatches', () => {
  it('accepts the configured static header', () => {
    expect(tokenMatches(SECRET, SECRET)).toBe(true);
  });

  it('refuses a wrong value', () => {
    expect(tokenMatches('not-the-secret', SECRET)).toBe(false);
  });

  /** A length mismatch must be a false, never a throw: the throw leaks the length. */
  it('refuses a value of a different length without throwing', () => {
    expect(tokenMatches('short', SECRET)).toBe(false);
    expect(tokenMatches(`${SECRET}-and-then-some-more`, SECRET)).toBe(false);
  });

  it('refuses an absent header', () => {
    expect(tokenMatches(undefined, SECRET)).toBe(false);
    expect(tokenMatches('', SECRET)).toBe(false);
  });
});

describe('signatureValid', () => {
  const payload = '{"event_name":"hardbounce"}';

  function sign(content: string): string {
    return crypto.createHmac('sha256', SECRET).update(content).digest('base64');
  }

  it('accepts an HMAC over the payload with no timestamp', () => {
    expect(signatureValid({ header: `sig=${sign(payload)}`, payload, secret: SECRET })).toBe(true);
  });

  it('accepts an HMAC over timestamp.payload, which is the documented shape', () => {
    const ts = Date.now();
    const header = `ts=${ts};sig=${sign(`${ts}.${payload}`)}`;
    expect(signatureValid({ header, payload, secret: SECRET, now: ts })).toBe(true);
  });

  it('refuses a signature computed with a different key', () => {
    const wrong = crypto.createHmac('sha256', 'another-secret').update(payload).digest('base64');
    expect(signatureValid({ header: `sig=${wrong}`, payload, secret: SECRET })).toBe(false);
  });

  it('refuses a signature over a different payload', () => {
    expect(signatureValid({ header: `sig=${sign('{"event_name":"open"}')}`, payload, secret: SECRET })).toBe(false);
  });

  /**
   * The replay defence. Without it a captured hard-bounce delivery could be
   * resent forever to suppress any address on demand.
   */
  it('refuses a correctly signed payload that is older than the tolerance', () => {
    const ts = Date.now() - 10 * 60 * 1000;
    const header = `ts=${ts};sig=${sign(`${ts}.${payload}`)}`;
    expect(signatureValid({ header, payload, secret: SECRET, now: Date.now() })).toBe(false);
  });

  it('accepts one inside the tolerance', () => {
    const now = Date.now();
    const ts = now - 60 * 1000;
    const header = `ts=${ts};sig=${sign(`${ts}.${payload}`)}`;
    expect(signatureValid({ header, payload, secret: SECRET, now })).toBe(true);
  });

  it('refuses a non-numeric timestamp rather than ignoring it', () => {
    const header = `ts=yesterday;sig=${sign(payload)}`;
    expect(signatureValid({ header, payload, secret: SECRET })).toBe(false);
  });

  it('refuses an absent header', () => {
    expect(signatureValid({ header: undefined, payload, secret: SECRET })).toBe(false);
  });
});
