import { describe, expect, it } from 'vitest';
import { shouldInjectApiKey } from './backendProxy';

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
