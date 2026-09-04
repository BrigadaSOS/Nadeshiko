import { describe, expect, it } from 'vitest';
import pino from 'pino';
import { REDACT_PATHS } from '@brigadasos/nadeshiko-shared/logRedaction';
import {
  buildHttpLoggerOptions,
  capLoggedBody,
  MAX_LOGGED_BODY_BYTES,
  safeParseJson,
  sanitizeRequestUrl,
  shouldUsePrettyLogsForEntrypoint,
} from '@config/log';

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

describe('capLoggedBody', () => {
  it('passes small bodies through untouched', () => {
    const body = { ok: true };
    expect(capLoggedBody(body)).toBe(body);
  });

  it('replaces an oversized object body with a marker', () => {
    const body = { blob: 'x'.repeat(MAX_LOGGED_BODY_BYTES) };

    expect(capLoggedBody(body)).toContain('exceeds the');
  });

  it('replaces an oversized string body with a marker', () => {
    const body = 'x'.repeat(MAX_LOGGED_BODY_BYTES + 1);

    expect(capLoggedBody(body)).toBe(
      `[Body omitted: ${MAX_LOGGED_BODY_BYTES + 1} bytes exceeds the ${MAX_LOGGED_BODY_BYTES} byte log limit]`,
    );
  });

  it('leaves unserializable bodies to pino instead of throwing', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    expect(capLoggedBody(circular)).toBe(circular);
  });
});

describe('sanitizeRequestUrl', () => {
  it('keeps routing context while redacting sensitive query values case-insensitively', () => {
    expect(
      sanitizeRequestUrl('/v1/auth/callback?code=oauth&state=keep&apiKey=key&TOKEN=magic&email=a@example.com'),
    ).toBe(
      '/v1/auth/callback?code=%5BRedacted%5D&state=keep&apiKey=%5BRedacted%5D&TOKEN=%5BRedacted%5D&email=%5BRedacted%5D',
    );
  });

  it('drops an unparseable query string rather than logging it verbatim', () => {
    expect(sanitizeRequestUrl('http://[?token=magic')).toBe('http://[');
  });
});

describe('buildHttpLoggerOptions', () => {
  const options = buildHttpLoggerOptions({} as any);

  it('redacts credentials after HTTP serialization, including successful session responses', () => {
    const lines: string[] = [];
    const log = pino({ redact: [...REDACT_PATHS] }, { write: (line) => lines.push(line) });
    const req = {
      method: 'POST',
      url: '/v1/auth/sign-in/email-otp',
      headers: {
        cookie: 'session=private-cookie',
        authorization: 'Bearer private-key',
        'x-internal-proxy-auth': 'private-proxy-secret',
        'x-rate-limit-bypass': 'private-bypass-secret',
      },
      rawBody: JSON.stringify({ email: 'private-email@example.com', otp: 'private-otp' }),
    };
    const res = {
      statusCode: 200,
      getHeaders: () => ({
        'set-cookie': ['nadeshiko.session_token=private-session; HttpOnly'],
        'content-type': 'application/json',
      }),
    };
    log.info({ req: options.serializers.req(req as any), res: options.serializers.res(res as any) });

    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toContain('private-');
    const entry = JSON.parse(lines[0]!);
    expect(entry.req.url).toBe('/v1/auth/sign-in/email-otp');
    expect(entry.req.body.otp).toBe('[Redacted]');
    expect(entry.res.statusCode).toBe(200);
    expect(entry.res.headers['content-type']).toBe('application/json');
    expect(entry.res.headers['set-cookie']).toBe('[Redacted]');
  });

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

  it('serializes response headers and parsed response body for error responses', () => {
    const res = {
      raw: {
        statusCode: 400,
        getHeaders: () => ({ 'content-type': 'application/json' }),
        responseBody: '{"ok":false}',
      },
    };

    const serialized = (options as any).serializers.res(res);
    expect(serialized).toMatchObject({
      statusCode: 400,
      headers: { 'content-type': 'application/json' },
      body: { ok: false },
    });
  });

  it('keeps response body as-is when already an object for error responses', () => {
    const res = {
      statusCode: 500,
      getHeaders: () => ({}),
      responseBody: { nested: true },
    };

    const serialized = (options as any).serializers.res(res);
    expect(serialized.body).toEqual({ nested: true });
  });

  it('caps an oversized error response body', () => {
    const res = {
      raw: {
        statusCode: 500,
        getHeaders: () => ({}),
        responseBody: { blob: 'x'.repeat(MAX_LOGGED_BODY_BYTES) },
      },
    };

    const serialized = (options as any).serializers.res(res);
    expect(serialized.body).toContain('exceeds the');
  });

  it('does not include body for successful responses', () => {
    const res = {
      raw: {
        statusCode: 200,
        getHeaders: () => ({}),
        responseBody: '{"ok":true}',
      },
    };

    const serialized = (options as any).serializers.res(res);
    expect(serialized.body).toBeUndefined();
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

  it('uses the sanitized URL consistently in HTTP fields and messages', () => {
    const req = {
      method: 'GET',
      url: '/v1/auth/callback?token=magic&next=%2Fstats',
      headers: {},
      raw: {
        method: 'GET',
        url: '/v1/auth/callback?token=magic&next=%2Fstats',
        headers: {},
      },
    };
    const res = { statusCode: 200, getHeader: () => undefined };

    expect((options as any).customProps(req, res)['http.url']).toBe(
      '/v1/auth/callback?token=%5BRedacted%5D&next=%2Fstats',
    );
    expect((options as any).customSuccessMessage(req, res)).toBe(
      'GET /v1/auth/callback?token=%5BRedacted%5D&next=%2Fstats completed with 200',
    );
  });
});
