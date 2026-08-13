import { describe, it, expect } from 'vitest';
import { firstNonBlank } from './strings';

describe('firstNonBlank', () => {
  it('returns the first value that says something', () => {
    expect(firstNonBlank('Romaji', 'English', 'Japanese')).toBe('Romaji');
  });

  it('skips past empty and whitespace-only values', () => {
    expect(firstNonBlank('', '   ', 'English')).toBe('English');
  });

  it('skips past null and undefined without stopping', () => {
    expect(firstNonBlank(undefined, null, 'Japanese')).toBe('Japanese');
  });

  // The distinction the activity API cares about: an omitted field is absent, an
  // empty one claims a name exists and is blank. Only `undefined` omits the field.
  it('returns undefined rather than an empty string when nothing is left', () => {
    expect(firstNonBlank('', '  ', undefined, null)).toBeUndefined();
  });

  it('returns a surviving value unchanged', () => {
    expect(firstNonBlank('  Padded Title  ')).toBe('  Padded Title  ');
  });
});
