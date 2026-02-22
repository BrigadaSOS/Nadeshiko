import { describe, it, expect, vi, beforeEach, mock } from 'bun:test';

// ---------------------------------------------------------------------------
// Mock OpenTelemetry tracer — define mocks before mock.module
// ---------------------------------------------------------------------------

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

mock.module('@opentelemetry/api', () => ({
  SpanKind: { INTERNAL: 0, SERVER: 1, CLIENT: 2, PRODUCER: 3, CONSUMER: 4 },
  SpanStatusCode: { UNSET: 0, OK: 1, ERROR: 2 },
  trace: {
    getTracer: () => mockTracer,
  },
}));

// Dynamic import so the mock is active when the module loads
const { tracingMiddleware } = await import('@app/middleware/tracing');
const { SpanKind, SpanStatusCode } = await import('@opentelemetry/api');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildReq(overrides: Record<string, unknown> = {}) {
  return {
    method: 'GET',
    path: '/v1/media',
    originalUrl: '/v1/media?take=10',
    requestId: 'nade-test-123',
    ...overrides,
  } as any;
}

function buildRes() {
  const listeners: Record<string, Function> = {};
  return {
    statusCode: 200,
    on: vi.fn((event: string, cb: Function) => {
      listeners[event] = cb;
    }),
    _trigger: (event: string) => listeners[event]?.(),
  } as any;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
});

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

  it('sets status_code and ends span on response finish', () => {
    const req = buildReq();
    const res = buildRes();
    const next = vi.fn();

    tracingMiddleware(req, res, next);
    res._trigger('finish');

    expect(mockSpan.setAttribute).toHaveBeenCalledWith('http.status_code', 200);
    expect(mockSpan.end).toHaveBeenCalledTimes(1);
  });

  it('sets ERROR status for 5xx responses', () => {
    const req = buildReq();
    const res = buildRes();
    res.statusCode = 500;
    const next = vi.fn();

    tracingMiddleware(req, res, next);
    res._trigger('finish');

    expect(mockSpan.setStatus).toHaveBeenCalledWith({ code: SpanStatusCode.ERROR });
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
