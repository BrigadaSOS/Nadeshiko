import { describe, it, expect } from 'vitest';
import { applyRenewedSessionCookies, renewedSessionCookies } from '~~/server/utils/sessionCookieRenewal';

function headersWith(...setCookies: string[]): Headers {
  const headers = new Headers();
  for (const cookie of setCookies) headers.append('set-cookie', cookie);
  return headers;
}

const TOKEN = 'nadeshiko.session_token=abc.signature; Path=/; HttpOnly; Max-Age=2592000';
const SECURE_TOKEN = '__Secure-nadeshiko.session_token=abc.signature; Path=/; HttpOnly; Secure';
const CACHE = 'nadeshiko.session_data=payload; Path=/; Max-Age=300';

/**
 * The whole failure mode this guards against is silent: pick the cookie names
 * wrong and nothing is forwarded, nothing errors, and readers keep being signed
 * out 30 days after they signed in -- which is exactly how the bug survived
 * this long.
 */
describe('renewedSessionCookies', () => {
  it('picks up the session token', () => {
    expect(renewedSessionCookies(headersWith(TOKEN))).toEqual([TOKEN]);
  });

  it('picks it up under the secure prefix, which is what production writes', () => {
    expect(renewedSessionCookies(headersWith(SECURE_TOKEN))).toEqual([SECURE_TOKEN]);
  });

  it('picks up the chunked variants together', () => {
    const chunks = ['nadeshiko.session_token.0=one; Path=/', 'nadeshiko.session_token.1=two; Path=/'];
    expect(renewedSessionCookies(headersWith(...chunks))).toEqual(chunks);
  });

  it('leaves the cookie cache behind', () => {
    // Rewritten on every single get-session, and forwarding it would put a
    // kilobyte on every render and on every request the browser made after it.
    expect(renewedSessionCookies(headersWith(CACHE, TOKEN))).toEqual([TOKEN]);
  });

  it('is empty when nothing was renewed', () => {
    // The common case by far: a session is only rewritten once a week.
    expect(renewedSessionCookies(headersWith())).toEqual([]);
    expect(renewedSessionCookies(undefined)).toEqual([]);
    expect(renewedSessionCookies(null)).toEqual([]);
  });

  it('does not match a cookie that merely starts with the same name', () => {
    expect(renewedSessionCookies(headersWith('nadeshiko.session_token_backup=x; Path=/'))).toEqual([]);
  });
});

describe('applyRenewedSessionCookies', () => {
  it('appends beside cookies the render already wrote', () => {
    // `setResponseHeader` would drop the preferences stamp the proxy writes.
    const existing = 'nd-prefs-version=1755648000000; Path=/';
    const headers: Record<string, string | string[]> = { 'set-cookie': existing };
    const event = {
      node: {
        res: {
          getHeader: (name: string) => headers[name.toLowerCase()],
          setHeader: (name: string, value: string | string[]) => {
            headers[name.toLowerCase()] = value;
          },
          getHeaders: () => headers,
          headersSent: false,
        },
      },
    } as any;

    applyRenewedSessionCookies(event, [TOKEN]);

    expect(headers['set-cookie']).toEqual([existing, TOKEN]);
  });
});
