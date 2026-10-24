import { describe, expect, it } from 'vitest';
import { sanitizeRequestUrl } from './logRedaction';

describe('sanitizeRequestUrl', () => {
  it('replaces credential values whatever case the name arrived in', () => {
    expect(sanitizeRequestUrl('/v1/auth/magic-link/verify?Token=abc&callbackURL=%2Fen')).toBe(
      '/v1/auth/magic-link/verify?Token=%5BRedacted%5D&callbackURL=%2Fen',
    );
  });

  it('leaves a URL without credentials as it was', () => {
    expect(sanitizeRequestUrl('/en/search/neko?category=ANIME')).toBe('/en/search/neko?category=ANIME');
  });

  it('drops the query rather than leak it when the URL cannot be parsed', () => {
    expect(sanitizeRequestUrl('http://[bad/x?token=abc')).toBe('http://[bad/x');
  });
});
