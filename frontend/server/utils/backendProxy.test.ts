import { describe, expect, it } from 'vitest';
import { shouldInjectApiKey, stampPreferencesVersion, writesPreferences } from './backendProxy';

describe('shouldInjectApiKey', () => {
  it('signs the public corpus reads an anonymous visitor needs', () => {
    expect(shouldInjectApiKey('POST', '/v1/search')).toBe(true);
    expect(shouldInjectApiKey('POST', '/v1/search/media')).toBe(true);
    expect(shouldInjectApiKey('GET', '/v1/stats/overview')).toBe(true);
    expect(shouldInjectApiKey('GET', '/v1/media/V1StGXR8_Z5d/episodes/12/segments')).toBe(true);
  });

  // The master key is the backend's service account. Signing an owner-scoped
  // route with it would answer the visitor with that account's own data.
  it('never signs owner-scoped routes', () => {
    expect(shouldInjectApiKey('GET', '/v1/user/me')).toBe(false);
    expect(shouldInjectApiKey('GET', '/v1/user/activity')).toBe(false);
    expect(shouldInjectApiKey('GET', '/v1/collections')).toBe(false);
    expect(shouldInjectApiKey('GET', '/v1/admin/reports')).toBe(false);
  });

  it('never signs corpus writes, even on an allowlisted path', () => {
    expect(shouldInjectApiKey('POST', '/v1/media')).toBe(false);
    expect(shouldInjectApiKey('DELETE', '/v1/media/V1StGXR8_Z5d')).toBe(false);
    expect(shouldInjectApiKey('PATCH', '/v1/media/segments/V1StGXR8_Z5d')).toBe(false);
  });

  it('matches whole path segments rather than prefixes', () => {
    expect(shouldInjectApiKey('GET', '/v1/media/V1StGXR8_Z5d/episodes/12/segments/extra')).toBe(false);
    expect(shouldInjectApiKey('POST', '/v1/searching')).toBe(false);
  });

  it('accepts the method in any casing', () => {
    expect(shouldInjectApiKey('get', '/v1/media')).toBe(true);
  });
});

/**
 * Which writes have to bust the SSR identity cache. Favourites and hidden media
 * live in the same preferences column the cache stores beside the session, so a
 * write to any of them makes a cached render wrong.
 */
describe('writesPreferences', () => {
  it('catches the three routes that rewrite the preferences column', () => {
    expect(writesPreferences('PATCH', '/v1/user/preferences')).toBe(true);
    expect(writesPreferences('POST', '/v1/user/favorite-media')).toBe(true);
    expect(writesPreferences('DELETE', '/v1/user/favorite-media/o5TILLJ9oQi0')).toBe(true);
    expect(writesPreferences('POST', '/v1/user/excluded-media')).toBe(true);
    expect(writesPreferences('DELETE', '/v1/user/excluded-media/o5TILLJ9oQi0')).toBe(true);
  });

  it('leaves reads alone', () => {
    expect(writesPreferences('GET', '/v1/user/preferences')).toBe(false);
    expect(writesPreferences('GET', '/v1/user/favorite-media')).toBe(false);
    expect(writesPreferences('HEAD', '/v1/user/favorite-media')).toBe(false);
  });

  it('does NOT treat activity tracking as a preferences write', () => {
    // This fires on arrival at every search. Busting the cache here would undo
    // the cache entirely, which is the cost it exists to avoid.
    expect(writesPreferences('POST', '/v1/user/activity')).toBe(false);
    expect(writesPreferences('DELETE', '/v1/user/activity')).toBe(false);
    expect(writesPreferences('DELETE', '/v1/user/activity/42')).toBe(false);
    expect(writesPreferences('DELETE', '/v1/user/familiar-media')).toBe(false);
  });

  it('matches whole segments rather than prefixes', () => {
    expect(writesPreferences('POST', '/v1/user/preferences-export')).toBe(false);
    expect(writesPreferences('POST', '/v1/user/favorite-media-archive')).toBe(false);
  });

  it('accepts the method in any casing', () => {
    expect(writesPreferences('patch', '/v1/user/preferences')).toBe(true);
    expect(writesPreferences('get', '/v1/user/preferences')).toBe(false);
  });
});

/**
 * The append, which is the part that is easy to get wrong and impossible to
 * notice. `sendProxy` installs the backend's own `Set-Cookie` with `setHeader`,
 * replacing whatever was there, so a stamp written before the proxy call
 * survives only until the day the backend sets a cookie on one of these routes
 * -- and then the SSR cache silently goes stale again.
 */
describe('stampPreferencesVersion', () => {
  function resEvent(existing?: string | string[]) {
    const headers: Record<string, any> = existing ? { 'set-cookie': existing } : {};
    return {
      node: {
        res: {
          getHeader: (n: string) => headers[n],
          setHeader: (n: string, v: any) => {
            headers[n] = v;
          },
          removeHeader: (n: string) => {
            delete headers[n];
          },
          appendHeader: (n: string, v: any) => {
            const current = headers[n];
            if (current === undefined) {
              headers[n] = v;
              return;
            }
            headers[n] = [...(Array.isArray(current) ? current : [current]), v];
          },
        },
      },
      _headers: headers,
    } as any;
  }

  const cookiesOf = (event: any): string[] => {
    const v = event._headers['set-cookie'];
    return Array.isArray(v) ? v : v ? [v] : [];
  };

  it('sets the stamp when the response carries no cookies', () => {
    const event = resEvent();
    stampPreferencesVersion(event, true);
    expect(cookiesOf(event).some((c) => c.startsWith('nd-prefs-version='))).toBe(true);
  });

  it('keeps a cookie the backend already set', () => {
    const event = resEvent('nadeshiko.session_token=rotated; Path=/; HttpOnly');
    stampPreferencesVersion(event, true);
    const cookies = cookiesOf(event);
    expect(cookies.some((c) => c.startsWith('nadeshiko.session_token=rotated'))).toBe(true);
    expect(cookies.some((c) => c.startsWith('nd-prefs-version='))).toBe(true);
  });

  it('marks the stamp HttpOnly, and Secure only over https', () => {
    const secure = resEvent();
    stampPreferencesVersion(secure, true);
    const overTls = cookiesOf(secure).find((c) => c.startsWith('nd-prefs-version=')) ?? '';
    expect(overTls).toContain('HttpOnly');
    expect(overTls).toContain('Secure');

    const plain = resEvent();
    stampPreferencesVersion(plain, false);
    expect(cookiesOf(plain).find((c) => c.startsWith('nd-prefs-version=')) ?? '').not.toContain('Secure');
  });

  it('outlives the cache entry it steers readers away from', () => {
    const event = resEvent();
    stampPreferencesVersion(event, true);
    const cookie = cookiesOf(event).find((c) => c.startsWith('nd-prefs-version=')) ?? '';
    const maxAge = Number(/Max-Age=(\d+)/i.exec(cookie)?.[1]);
    // The cache holds an entry for 30s; a shorter stamp would hand the reader
    // back the very entry it was minted to skip.
    expect(maxAge).toBeGreaterThanOrEqual(30);
  });
});
