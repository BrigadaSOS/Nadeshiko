import { describe, it, expect, vi, beforeEach } from 'bun:test';
import { SpanKind, SpanStatusCode } from '@opentelemetry/api';

const mockSpan = {
  setAttributes: vi.fn(),
  setAttribute: vi.fn(),
  setStatus: vi.fn(),
  end: vi.fn(),
};

const mockTracer = {
  startActiveSpan: vi.fn((_name: string, _options: unknown, cb: (span: typeof mockSpan) => void) => {
    cb(mockSpan);
  }),
};

const mockHistogram = { record: vi.fn() };
const mockUpDownCounter = { add: vi.fn() };

const mockMeter = {
  createHistogram: vi.fn(() => mockHistogram),
  createUpDownCounter: vi.fn(() => mockUpDownCounter),
};

vi.mock('@opentelemetry/api', () => ({
  SpanKind: { SERVER: 1 },
  SpanStatusCode: { ERROR: 2 },
}));

vi.mock('@config/telemetry', () => ({
  getMeter: vi.fn(() => mockMeter),
  getTracer: vi.fn(() => mockTracer),
}));

const { tracingMiddleware } = await import('@app/middleware/tracing');

beforeEach(() => {
  vi.clearAllMocks();
  mockTracer.startActiveSpan.mockImplementation(
    (_name: string, _options: unknown, cb: (span: typeof mockSpan) => void) => cb(mockSpan),
  );
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
  it('starts a span with the correct name and SERVER kind', () => {
    const req = buildReq();
    const res = buildRes();
    const next = vi.fn();

    tracingMiddleware(req, res, next);

    expect(mockTracer.startActiveSpan).toHaveBeenCalledWith(
      'GET /v1/media',
      { kind: SpanKind.SERVER },
      expect.any(Function),
    );
  });

  it('sets http attributes on the span', () => {
    const req = buildReq();
    const res = buildRes();
    const next = vi.fn();

    tracingMiddleware(req, res, next);

    expect(mockSpan.setAttributes).toHaveBeenCalledWith({
      'http.method': 'GET',
      'http.url': '/v1/media?take=10',
      'http.request_id': 'nade-test-123',
    });
  });

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

  it('sets status_code and ends span on response finish', () => {
    const req = buildReq();
    const res = buildRes();
    const next = vi.fn();

    tracingMiddleware(req, res, next);
    res._trigger('finish');

    expect(mockSpan.setAttribute).toHaveBeenCalledWith('http.status_code', 200);
    expect(mockSpan.end).toHaveBeenCalledTimes(1);
  });

  it('sets ERROR status and error.type for 5xx responses', () => {
    const req = buildReq();
    const res = buildRes();
    res.statusCode = 500;
    const next = vi.fn();

    tracingMiddleware(req, res, next);
    res._trigger('finish');

    expect(mockSpan.setStatus).toHaveBeenCalledWith({ code: SpanStatusCode.ERROR });
    expect(mockHistogram.record).toHaveBeenCalledWith(
      expect.any(Number),
      expect.objectContaining({ 'error.type': '500' }),
    );
    expect(mockSpan.end).toHaveBeenCalledTimes(1);
  });

  it('does not set ERROR status for 4xx responses', () => {
    const req = buildReq();
    const res = buildRes();
    res.statusCode = 404;
    const next = vi.fn();

    tracingMiddleware(req, res, next);
    res._trigger('finish');

    expect(mockSpan.setStatus).not.toHaveBeenCalled();
    expect(mockSpan.end).toHaveBeenCalledTimes(1);
  });
});
