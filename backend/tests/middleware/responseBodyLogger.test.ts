import { describe, it, expect, vi } from 'bun:test';
import { responseBodyLogger } from '@app/middleware/responseBodyLogger';

function buildMockRes() {
  const res: any = {};
  res.json = vi.fn().mockReturnValue(res);
  res.send = vi.fn().mockReturnValue(res);
  return res;
}

describe('responseBodyLogger', () => {
  it('captures body from res.json() on res.responseBody', () => {
    const req = {} as any;
    const res = buildMockRes();
    const originalJson = res.json;
    const next = vi.fn();

    responseBodyLogger(req, res, next);
    res.json({ message: 'hello' });

    expect(res.responseBody).toEqual({ message: 'hello' });
    expect(originalJson).toHaveBeenCalledWith({ message: 'hello' });
  });

  it('captures body from res.send() on res.responseBody', () => {
    const req = {} as any;
    const res = buildMockRes();
    const originalSend = res.send;
    const next = vi.fn();

    responseBodyLogger(req, res, next);
    res.send('plain text');

    expect(res.responseBody).toBe('plain text');
    expect(originalSend).toHaveBeenCalledWith('plain text');
  });

  it('calls next()', () => {
    const req = {} as any;
    const res = buildMockRes();
    const next = vi.fn();

    responseBodyLogger(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
  });
});
