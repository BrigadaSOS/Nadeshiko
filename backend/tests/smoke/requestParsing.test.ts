import { describe, expect, test } from 'bun:test';
import { handleJsonParseErrors } from '../../app/middleware/requestParsing';

describe('handleJsonParseErrors', () => {
  test('returns INVALID_JSON with request instance for malformed JSON', () => {
    const parseError = new SyntaxError('Unexpected token') as SyntaxError & { body: string };
    parseError.body = '{invalid';

    const result: { statusCode?: number; payload?: Record<string, unknown> } = {};
    const res: any = {
      status(code: number) {
        result.statusCode = code;
        return this;
      },
      json(payload: Record<string, unknown>) {
        result.payload = payload;
        return this;
      },
    };

    let nextCalled = false;
    handleJsonParseErrors(parseError, { requestId: 'req-123' } as any, res, () => {
      nextCalled = true;
    });

    expect(nextCalled).toBe(false);
    expect(result.statusCode).toBe(400);
    expect(result.payload?.code).toBe('INVALID_JSON');
    expect(result.payload?.instance).toBe('req-123');
  });
});
