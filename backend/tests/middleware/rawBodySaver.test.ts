import { describe, it, expect } from 'bun:test';
import { rawBodySaver } from '@app/middleware/rawBodySaver';

describe('rawBodySaver', () => {
  it('stores raw body as string on req.rawBody', () => {
    const req = {} as any;
    const res = {} as any;
    const buf = Buffer.from('{"name":"test"}');

    rawBodySaver(req, res, buf, 'utf8');

    expect(req.rawBody).toBe('{"name":"test"}');
  });

  it('handles empty buffer', () => {
    const req = {} as any;
    const res = {} as any;
    const buf = Buffer.from('');

    rawBodySaver(req, res, buf, 'utf8');

    expect(req.rawBody).toBe('');
  });
});
