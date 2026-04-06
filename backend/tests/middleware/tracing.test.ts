import { describe, it, expect, vi, beforeEach } from 'bun:test';

const mockHistogram = { record: vi.fn() };
const mockUpDownCounter = { add: vi.fn() };

const mockMeter = {
  createHistogram: vi.fn(() => mockHistogram),
  createUpDownCounter: vi.fn(() => mockUpDownCounter),
};

vi.mock('@config/telemetry', () => ({
  getMeter: vi.fn(() => mockMeter),
}));

const { tracingMiddleware } = await import('@app/middleware/tracing');

beforeEach(() => {
  vi.clearAllMocks();
});

function buildReq(overrides: Record<string, unknown> = {}) {
  return {
    method: 'GET',
    path: '/v1/media',
    originalUrl: '/v1/media?take=10',
    requestId: 'nade-test-123',
    protocol: 'https',
    headers: {},
    ...overrides,
  } as any;
}

function buildRes() {
  const listeners: Record<string, (...args: never) => unknown> = {};
  return {
    statusCode: 200,
    on: vi.fn((event: string, cb: (...args: never) => unknown) => {
      listeners[event] = cb;
    }),
    getHeader: vi.fn(() => undefined),
    _trigger: (event: string) => listeners[event]?.(),
  } as any;
}

describe('tracingMiddleware', () => {
  it('calls next()', () => {
    const req = buildReq();
    const res = buildRes();
    const next = vi.fn();

    tracingMiddleware(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
  });

  it('increments active requests on entry and decrements on finish', () => {
    const req = buildReq();
    const res = buildRes();
    const next = vi.fn();

    tracingMiddleware(req, res, next);

    expect(mockUpDownCounter.add).toHaveBeenCalledWith(1, {
      'http.request.method': 'GET',
      'url.scheme': 'https',
    });

    res._trigger('finish');

    expect(mockUpDownCounter.add).toHaveBeenCalledWith(-1, {
      'http.request.method': 'GET',
      'url.scheme': 'https',
    });
  });

  it('records request duration on finish', () => {
    const req = buildReq();
    const res = buildRes();
    const next = vi.fn();

    tracingMiddleware(req, res, next);
    res._trigger('finish');

    expect(mockHistogram.record).toHaveBeenCalledWith(
      expect.any(Number),
      expect.objectContaining({
        'http.request.method': 'GET',
        'http.route': '/v1/media',
        'http.response.status_code': 200,
        'url.scheme': 'https',
      }),
    );
  });

  it('records request body size when content-length header is present', () => {
    const req = buildReq({ headers: { 'content-length': '1024' } });
    const res = buildRes();
    const next = vi.fn();

    tracingMiddleware(req, res, next);
    res._trigger('finish');

    expect(mockHistogram.record).toHaveBeenCalledWith(1024, expect.any(Object));
  });

  it('records response body size when content-length header is present', () => {
    const req = buildReq();
    const res = buildRes();
    res.getHeader = vi.fn(() => '2048');
    const next = vi.fn();

    tracingMiddleware(req, res, next);
    res._trigger('finish');

    expect(mockHistogram.record).toHaveBeenCalledWith(2048, expect.any(Object));
  });

  it('adds error.type for 5xx responses', () => {
    const req = buildReq();
    const res = buildRes();
    res.statusCode = 500;
    const next = vi.fn();

    tracingMiddleware(req, res, next);
    res._trigger('finish');

    expect(mockHistogram.record).toHaveBeenCalledWith(
      expect.any(Number),
      expect.objectContaining({ 'error.type': '500' }),
    );
  });

  it('does not add error.type for 4xx responses', () => {
    const req = buildReq();
    const res = buildRes();
    res.statusCode = 404;
    const next = vi.fn();

    tracingMiddleware(req, res, next);
    res._trigger('finish');

    expect(mockHistogram.record).toHaveBeenCalledWith(
      expect.any(Number),
      expect.not.objectContaining({ 'error.type': expect.any(String) }),
    );
  });
});
