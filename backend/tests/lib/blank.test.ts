import { describe, it, expect } from 'vitest';
import { blankToNull } from '@lib/utils/blank';

describe('blankToNull', () => {
  it('keeps a value that says something', () => {
    expect(blankToNull('Some Show')).toBe('Some Show');
  });

  it('reads an empty string as absent', () => {
    expect(blankToNull('')).toBeNull();
  });

  it('reads a whitespace-only string as absent', () => {
    expect(blankToNull('   ')).toBeNull();
  });

  it('passes null and undefined straight through to null', () => {
    expect(blankToNull(null)).toBeNull();
    expect(blankToNull(undefined)).toBeNull();
  });

  // Normalizes presence, not content: a surviving value is stored as the client
  // sent it, so this never silently rewrites a name.
  it('does not trim a value that survives', () => {
    expect(blankToNull('  Some Show  ')).toBe('  Some Show  ');
  });
});
