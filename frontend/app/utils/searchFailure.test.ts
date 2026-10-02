import { describe, expect, it } from 'vitest';
import { canRetrySearchFailure, classifySearchFailure, SEARCH_FAILURE_MESSAGES } from './searchFailure';
import en from '../../i18n/locales/en.json';

describe('search failure classification', () => {
  it.each([400, 404, 429, 500, 503, 522, 0, undefined])(
    'normalizes status %s to only a frontend-owned category',
    (status) => {
      const failure = classifySearchFailure(status, 'corpus');
      expect(Object.keys(failure)).toEqual(['kind']);
      expect(SEARCH_FAILURE_MESSAGES[failure.kind].message).toMatch(/^(searchErrors|segment)\./);
    },
  );

  it('distinguishes a bad search request from a malformed identifier lookup', () => {
    expect(classifySearchFailure(400, 'corpus')).toEqual({ kind: 'invalid-request' });
    expect(classifySearchFailure(400, 'collection')).toEqual({ kind: 'not-found' });
    expect(classifySearchFailure(400, 'segment')).toEqual({ kind: 'not-found' });
  });

  it('recognizes only the known monthly quota header value', () => {
    expect(classifySearchFailure(429, 'corpus', 'monthly_quota')).toEqual({ kind: 'quota-exceeded' });
    expect(classifySearchFailure(429, 'corpus', '<script>secret</script>')).toEqual({ kind: 'rate-limited' });
    expect(classifySearchFailure(500, 'corpus', 'monthly_quota')).toEqual({ kind: 'unavailable' });
  });

  it('offers immediate retry only for availability failures', () => {
    for (const status of [400, 404, 429])
      expect(canRetrySearchFailure(classifySearchFailure(status, 'corpus'))).toBe(false);
    expect(canRetrySearchFailure(classifySearchFailure(503, 'corpus'))).toBe(true);
  });

  it('maps every category to an existing translated title and message', () => {
    for (const keys of Object.values(SEARCH_FAILURE_MESSAGES)) {
      for (const key of Object.values(keys)) {
        let value: unknown = en;
        for (const part of key.split('.')) value = (value as Record<string, unknown>)[part];
        expect(value).toEqual(expect.any(String));
      }
    }
  });
});
