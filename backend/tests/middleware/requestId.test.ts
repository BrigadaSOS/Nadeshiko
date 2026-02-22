import { describe, it, expect, vi } from 'bun:test';
import { requestIdMiddleware } from '@app/middleware/requestId';

describe('requestIdMiddleware', () => {
  it('sets requestId with nade- prefix and UUID format', () => {
    const req = {} as any;
    const res = {} as any;
    const next = vi.fn();

    requestIdMiddleware(req, res, next);

    expect(req.requestId).toMatch(/^nade-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it('generates a unique ID per call', () => {
    const req1 = {} as any;
    const req2 = {} as any;
    const res = {} as any;
    const next = vi.fn();

    requestIdMiddleware(req1, res, next);
    requestIdMiddleware(req2, res, next);

    expect(req1.requestId).not.toBe(req2.requestId);
  });

  it('calls next()', () => {
    const req = {} as any;
    const res = {} as any;
    const next = vi.fn();

    requestIdMiddleware(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
  });
});
