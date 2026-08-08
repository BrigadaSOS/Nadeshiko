import { describe, it, expect } from 'vitest';
import { RENDER_FORKING_PREFERENCE_COOKIES } from '#shared/utils/preferenceCookies';
import { htmlPathIsShareable, visitorCacheTier } from './visitorCacheTier';

function fakeEvent(cookieHeader?: string) {
  return {
    node: { req: { socket: { remoteAddress: '1.2.3.4' }, headers: { cookie: cookieHeader } } },
    headers: { cookie: cookieHeader },
  } as any;
}

describe('visitorCacheTier', () => {
  it('is shared for a request with no cookies', () => {
    expect(visitorCacheTier(fakeEvent(undefined))).toBe('shared');
  });

  it('is shared for cookies that do not reach the render', () => {
    // `nd-locale-preference` only picks where `/` redirects to; the rendered
    // locale is in the URL path. Verified byte-identical against a live render.
    expect(visitorCacheTier(fakeEvent('nd-locale-preference=es'))).toBe('shared');
    expect(visitorCacheTier(fakeEvent('_ga=GA1.1.123; some_other=1'))).toBe('shared');
  });

  it('is personal whenever a session cookie is present', () => {
    expect(visitorCacheTier(fakeEvent('nadeshiko.session_token=tok'))).toBe('personal');
    expect(visitorCacheTier(fakeEvent('__Secure-nadeshiko.session_token=tok'))).toBe('personal');
    expect(visitorCacheTier(fakeEvent('__Host-nadeshiko.session_token=tok'))).toBe('personal');
  });

  it('lets the session cookie win over a preference cookie', () => {
    // Signed in AND carrying preferences: the stricter tier has to win, or a
    // signed-in page becomes reusable by that browser for a different reader.
    expect(visitorCacheTier(fakeEvent('nd_hiragana=hidden; nadeshiko.session_token=tok'))).toBe('personal');
  });

  it('is browser for each cookie the server reads during render', () => {
    // Driven off the shared list, so a cookie added there without being thought
    // about here still gets covered rather than silently skipped.
    for (const name of RENDER_FORKING_PREFERENCE_COOKIES) {
      expect(visitorCacheTier(fakeEvent(`${name}=something`)), name).toBe('browser');
    }
  });

  it('treats an emptied preference cookie as no preference', () => {
    // `useCookiePreference` serialises "back to the default" as an empty value,
    // and a default renders identically to no cookie -- so it must not cost the
    // visitor the shared tier.
    expect(visitorCacheTier(fakeEvent('nd_hiragana='))).toBe('shared');
  });

  it('does not match a cookie that merely starts with a known name', () => {
    expect(visitorCacheTier(fakeEvent('nd_hiragana_old=hidden'))).toBe('shared');
  });
});

describe('htmlPathIsShareable', () => {
  it('allows the public corpus pages', () => {
    for (const path of ['/en', '/en/search/猫', '/en/sentence/abc', '/en/media', '/es/stats', '/en/blog', '/']) {
      expect(htmlPathIsShareable(path), path).toBe(true);
    }
  });

  it('refuses the account and admin screens, with and without a locale prefix', () => {
    for (const path of [
      '/en/user',
      '/en/user/collections',
      '/es/settings',
      '/en/admin/reports',
      '/en/reports',
      '/user/collections',
      '/settings',
    ]) {
      expect(htmlPathIsShareable(path), path).toBe(false);
    }
  });

  it('refuses collection pages, which may be private and are SSR-rendered with the service key', () => {
    expect(htmlPathIsShareable('/en/collection/abc123')).toBe(false);
  });

  it('does not refuse a public path that merely starts with a private word', () => {
    // `/en/users-guide` is not `/en/user`, and prefix-matching without the
    // boundary would have quietly excluded it from the cache forever.
    expect(htmlPathIsShareable('/en/users-guide')).toBe(true);
    expect(htmlPathIsShareable('/en/settings-explained')).toBe(true);
  });

  it('is not fooled by a locale-looking first segment that is not a locale', () => {
    expect(htmlPathIsShareable('/entertainment/user')).toBe(true);
  });
});
