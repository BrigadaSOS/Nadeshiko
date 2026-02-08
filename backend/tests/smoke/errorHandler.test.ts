import { describe, expect, test } from 'bun:test';
import { handleErrors } from '../../app/middleware/errorHandler';

describe('handleErrors', () => {
  test('returns 500 response with request instance for unknown errors', () => {
    const result: { statusCode?: number; payload?: Record<string, unknown> } = {};
    const res: any = {
      headersSent: false,
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
    handleErrors(new Error('boom'), { requestId: 'req-456' } as any, res, () => {
      nextCalled = true;
    });

    expect(nextCalled).toBe(false);
    expect(result.statusCode).toBe(500);
    expect(result.payload?.code).toBe('INTERNAL_SERVER_EXCEPTION');
    expect(result.payload?.instance).toBe('req-456');
  });
});
