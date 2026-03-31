import { describe, expect, test } from 'bun:test';
import { getAppEnvironment, isLocalEnvironment, isDevEnvironment, isProdEnvironment } from '@config/environment';

describe('getAppEnvironment', () => {
  test('returns "local" for local', () => {
    expect(getAppEnvironment('local')).toBe('local');
  });

  test('returns "development" for development', () => {
    expect(getAppEnvironment('development')).toBe('development');
  });

  test('returns "production" for production', () => {
    expect(getAppEnvironment('production')).toBe('production');
  });

  test('normalizes whitespace and casing', () => {
    expect(getAppEnvironment('  LOCAL  ')).toBe('local');
    expect(getAppEnvironment('DEVELOPMENT')).toBe('development');
    expect(getAppEnvironment(' Production ')).toBe('production');
  });

  test('throws for invalid values', () => {
    expect(() => getAppEnvironment('staging')).toThrow('Invalid ENVIRONMENT');
    expect(() => getAppEnvironment('')).toThrow('Invalid ENVIRONMENT');
    expect(() => getAppEnvironment(undefined)).toThrow('Invalid ENVIRONMENT');
  });
});

describe('environment helpers', () => {
  test('isLocalEnvironment', () => {
    expect(isLocalEnvironment('local')).toBe(true);
    expect(isLocalEnvironment('development')).toBe(false);
  });

  test('isDevEnvironment', () => {
    expect(isDevEnvironment('development')).toBe(true);
    expect(isDevEnvironment('local')).toBe(false);
  });

  test('isProdEnvironment', () => {
    expect(isProdEnvironment('production')).toBe(true);
    expect(isProdEnvironment('local')).toBe(false);
  });
});
