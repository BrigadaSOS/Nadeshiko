import { describe, expect, it } from 'bun:test';
import { buildHttpLoggerOptions, safeParseJson, shouldUsePrettyLogsForEntrypoint } from '@config/log';

describe('shouldUsePrettyLogsForEntrypoint', () => {
  it('returns true for known script entrypoints', () => {
    expect(shouldUsePrettyLogsForEntrypoint('/tmp/db.ts')).toBe(true);
    expect(shouldUsePrettyLogsForEntrypoint('/tmp/es.ts')).toBe(true);
    expect(shouldUsePrettyLogsForEntrypoint('/tmp/setup.ts')).toBe(true);
    expect(shouldUsePrettyLogsForEntrypoint('/tmp/dbBootstrap.ts')).toBe(true);
  });

  it('returns false for unknown entrypoints', () => {
    expect(shouldUsePrettyLogsForEntrypoint('/tmp/main.ts')).toBe(false);
  });
});

describe('safeParseJson', () => {
  it('parses valid JSON strings', () => {
    expect(safeParseJson('{"ok":true}')).toEqual({ ok: true });
  });

  it('returns original value for invalid JSON', () => {
    expect(safeParseJson('not-json')).toBe('not-json');
  });
});

describe('buildHttpLoggerOptions', () => {
  const options = buildHttpLoggerOptions({} as any);

  it('serializes request with requestId and parsed raw body', () => {
    const req = {
      method: 'POST',
      url: '/v1/media',
      headers: {},
      raw: {
        method: 'POST',
        url: '/v1/media',
        headers: {},
        requestId: 'nade-request-1',
        rawBody: '{"token":"secret"}',
      },
    };

    const serialized = (options as any).serializers.req(req);
    expect(serialized.requestId).toBe('nade-request-1');
    expect(serialized.body).toEqual({ token: 'secret' });
  });

  it('serializes response headers and parsed response body', () => {
    const res = {
      raw: {
        statusCode: 201,
        getHeaders: () => ({ 'content-type': 'application/json' }),
        responseBody: '{"ok":true}',
      },
    };

    const serialized = (options as any).serializers.res(res);
    expect(serialized).toMatchObject({
      statusCode: 201,
      headers: { 'content-type': 'application/json' },
      body: { ok: true },
    });
  });

  it('keeps response body as-is when already an object', () => {
    const res = {
      statusCode: 200,
      getHeaders: () => ({}),
      responseBody: { nested: true },
    };

    const serialized = (options as any).serializers.res(res);
    expect(serialized.body).toEqual({ nested: true });
  });

  it('maps custom log level by status code and error presence', () => {
    const customLogLevel = (options as any).customLogLevel;
    expect(customLogLevel({}, { statusCode: 200 }, undefined)).toBe('info');
    expect(customLogLevel({}, { statusCode: 404 }, undefined)).toBe('warn');
    expect(customLogLevel({}, { statusCode: 500 }, undefined)).toBe('error');
    expect(customLogLevel({}, { statusCode: 200 }, new Error('boom'))).toBe('error');
  });

  it('formats success and error messages with UNKNOWN fallbacks', () => {
    const successMessage = (options as any).customSuccessMessage({}, { statusCode: 204 });
    const errorMessage = (options as any).customErrorMessage({}, { statusCode: 500 }, { message: 'failed' });

    expect(successMessage).toBe('UNKNOWN UNKNOWN completed with 204');
    expect(errorMessage).toBe('UNKNOWN UNKNOWN failed with 500 - failed');
  });
});
