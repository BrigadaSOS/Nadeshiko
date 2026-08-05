import { describe, it, expect } from 'bun:test';
import { rawBodySaver } from '@app/middleware/rawBodySaver';
import { MAX_LOGGED_BODY_BYTES } from '@config/log';

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

  it('keeps a body that sits exactly on the log limit', () => {
    const req = {} as any;
    const buf = Buffer.alloc(MAX_LOGGED_BODY_BYTES, 'a');

    rawBodySaver(req, {} as any, buf, 'utf8');

    expect(req.rawBody).toHaveLength(MAX_LOGGED_BODY_BYTES);
  });

  it('replaces an oversized body with a marker instead of retaining it', () => {
    const req = {} as any;
    const buf = Buffer.alloc(MAX_LOGGED_BODY_BYTES + 1, 'a');

    rawBodySaver(req, {} as any, buf, 'utf8');

    expect(req.rawBody).toBe(`[Body omitted: ${buf.length} bytes exceeds the ${MAX_LOGGED_BODY_BYTES} byte log limit]`);
    expect(req.rawBody).not.toContain('aaaa');
  });
});
