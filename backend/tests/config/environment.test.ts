import { describe, expect, test } from 'bun:test';
import { getAppEnvironment, isLocalEnvironment, isDevEnvironment, isProdEnvironment } from '@config/environment';

describe('getAppEnvironment', () => {
  test('returns "local" for local', () => {
    expect(getAppEnvironment('local')).toBe('local');
  });

  test('returns "dev" for dev', () => {
    expect(getAppEnvironment('dev')).toBe('dev');
  });

  test('returns "prod" for prod', () => {
    expect(getAppEnvironment('prod')).toBe('prod');
  });

  test('normalizes whitespace and casing', () => {
    expect(getAppEnvironment('  LOCAL  ')).toBe('local');
    expect(getAppEnvironment('DEV')).toBe('dev');
    expect(getAppEnvironment(' Prod ')).toBe('prod');
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
    expect(isLocalEnvironment('dev')).toBe(false);
  });

  test('isDevEnvironment', () => {
    expect(isDevEnvironment('dev')).toBe(true);
    expect(isDevEnvironment('local')).toBe(false);
  });

  test('isProdEnvironment', () => {
    expect(isProdEnvironment('prod')).toBe(true);
    expect(isProdEnvironment('local')).toBe(false);
  });
});
