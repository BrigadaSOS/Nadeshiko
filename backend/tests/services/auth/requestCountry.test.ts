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

  /** Off-Cloudflare requests have no country; local, health-check, and container traffic must remain `null`. */
  it('is null when the header is absent or empty', () => {
    expect(countryFromHeaders(headers({}))).toBeNull();
    expect(countryFromHeaders(headers({ 'cf-ipcountry': '' }))).toBeNull();
    expect(countryFromHeaders(null)).toBeNull();
    expect(countryFromHeaders(undefined)).toBeNull();
  });

  /** `XX` and `T1` look like country codes but mean “unplaceable” and Tor; store `null` rather than an unrecognised
   * country value. */
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
  /** Exercise both accessors because better-auth accepts either `ctx.headers` or `ctx.request.headers`; IP and
   * country must come from the same request context. */
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

  /** Requests without context—seeds, tests, or admin scripts—must not throw. */
  it('is null with no context', () => {
    expect(countryFromAuthContext(null)).toBeNull();
    expect(countryFromAuthContext(undefined)).toBeNull();
    expect(countryFromAuthContext({})).toBeNull();
  });
});
