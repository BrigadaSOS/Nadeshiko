import { describe, expect, test } from 'bun:test';
import { getDbLogging } from '@config/schema';

describe('getDbLogging', () => {
  test('returns true when raw value is "true"', () => {
    expect(getDbLogging('true')).toBe(true);
  });

  test('returns false when raw value is "false"', () => {
    expect(getDbLogging('false')).toBe(false);
  });

  test('returns "all" when raw value is "all"', () => {
    expect(getDbLogging('all')).toBe('all');
  });

  test('returns array for comma-separated values', () => {
    expect(getDbLogging('query,error,warn')).toEqual(['query', 'error', 'warn']);
  });

  test('trims whitespace in comma-separated values', () => {
    expect(getDbLogging(' query , error ')).toEqual(['query', 'error']);
  });

  test('normalizes casing', () => {
    expect(getDbLogging('TRUE')).toBe(true);
    expect(getDbLogging('FALSE')).toBe(false);
    expect(getDbLogging('ALL')).toBe('all');
  });
});
