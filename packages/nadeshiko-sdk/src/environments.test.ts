/**
 * Tests for the environment table emitted into generated/internal/nadeshiko.gen.ts.
 *
 * The table is written by the generator as a template string, so a wrong URL in
 * it is not a type error and reaches consumers intact — `LOCAL` shipped pointing
 * at a `/api` prefix the backend does not serve. These tests pin each named
 * environment to the URL it must resolve to.
 */
import { describe, test, expect } from 'vitest';
import { createNadeshikoClient } from '../generated/internal';

function resolvedBaseUrl(baseURL?: string): string | undefined {
  return createNadeshikoClient({ baseURL }).client.getConfig().baseUrl;
}

describe('baseURL environment resolution', () => {
  test.each([
    ['LOCAL', 'http://localhost:5000'],
    ['DEVELOPMENT', 'https://api-stg.nadeshiko.co'],
    ['STAGING', 'https://api-stg.nadeshiko.co'],
    ['PRODUCTION', 'https://api.nadeshiko.co'],
  ])('%s resolves to %s', (name, expected) => {
    expect(resolvedBaseUrl(name)).toBe(expected);
  });

  test('LOCAL carries no /api prefix, which the backend does not serve', () => {
    expect(resolvedBaseUrl('LOCAL')).not.toContain('/api');
  });

  test('PROXY resolves to an empty base URL so requests stay same-origin', () => {
    expect(resolvedBaseUrl('PROXY')).toBe('');
  });

  test('an unrecognised value passes through as a custom base URL', () => {
    expect(resolvedBaseUrl('https://api.example.test')).toBe('https://api.example.test');
  });

  test('omitting baseURL falls back to production', () => {
    expect(resolvedBaseUrl(undefined)).toBe('https://api.nadeshiko.co');
  });

  test('the deprecated baseUrl spelling resolves the same way', () => {
    expect(createNadeshikoClient({ baseUrl: 'PROXY' }).client.getConfig().baseUrl).toBe('');
  });
});
