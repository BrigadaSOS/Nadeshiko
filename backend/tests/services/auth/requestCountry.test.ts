import { describe, it, expect } from 'vitest';
import { countryFromHeaders, countryFromAuthContext } from '@app/services/auth/requestCountry';

/** The shape better-auth hands the hook: a real `Headers`, or nothing. */
const headers = (values: Record<string, string>) => new Headers(values);

describe('countryFromHeaders', () => {
  it("reads Cloudflare's country", () => {
    expect(countryFromHeaders(headers({ 'cf-ipcountry': 'JP' }))).toBe('JP');
  });

  it('uppercases and trims, because a header is whatever the edge sent', () => {
    expect(countryFromHeaders(headers({ 'cf-ipcountry': ' cn ' }))).toBe('CN');
  });

  /**
   * Null is the ordinary answer off-Cloudflare: local development, a container
   * probe, a health check. None of those should look like a country.
   */
  it('is null when the header is absent or empty', () => {
    expect(countryFromHeaders(headers({}))).toBeNull();
    expect(countryFromHeaders(headers({ 'cf-ipcountry': '' }))).toBeNull();
    expect(countryFromHeaders(null)).toBeNull();
    expect(countryFromHeaders(undefined)).toBeNull();
  });

  /**
   * `XX` (unplaceable) and `T1` (Tor) have the shape of a country and are not
   * one. Storing them would put a code nobody recognises in a column where null
   * already says "we do not know".
   */
  it("drops Cloudflare's non-country codes", () => {
    expect(countryFromHeaders(headers({ 'cf-ipcountry': 'XX' }))).toBeNull();
    expect(countryFromHeaders(headers({ 'cf-ipcountry': 'T1' }))).toBeNull();
  });

  it('rejects anything that is not two letters', () => {
    for (const value of ['J', 'JPN', '12', 'J1', '??', 'japan']) {
      expect(countryFromHeaders(headers({ 'cf-ipcountry': value }))).toBeNull();
    }
  });
});

describe('countryFromAuthContext', () => {
  /**
   * Both accessors, because better-auth's own `createSession` resolves headers
   * as `ctx?.headers || ctx?.request?.headers` and this has to agree with it --
   * otherwise a row could carry an `ip_address` from one request and a country
   * from nowhere.
   */
  it('reads headers off the context', () => {
    expect(countryFromAuthContext({ headers: headers({ 'cf-ipcountry': 'ES' }) })).toBe('ES');
  });

  it('falls back to the request headers', () => {
    expect(countryFromAuthContext({ request: { headers: headers({ 'cf-ipcountry': 'BR' }) } })).toBe('BR');
  });

  it('prefers the context headers over the request headers', () => {
    const context = {
      headers: headers({ 'cf-ipcountry': 'JP' }),
      request: { headers: headers({ 'cf-ipcountry': 'US' }) },
    };
    expect(countryFromAuthContext(context)).toBe('JP');
  });

  /**
   * A session or user created outside a request -- a seed, a test, an admin
   * script -- has no context at all, and must not throw for it.
   */
  it('is null with no context', () => {
    expect(countryFromAuthContext(null)).toBeNull();
    expect(countryFromAuthContext(undefined)).toBeNull();
    expect(countryFromAuthContext({})).toBeNull();
  });
});
