import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EventEmitter } from 'node:events';

/**
 * The Elasticsearch client instrumentation, which was shipping with nothing
 * exercising it at all.
 *
 * What it produces is a metric label and a span name, and both are cardinality
 * decisions rather than cosmetics. `extractOperation` exists to turn a path
 * carrying an index name and a document id into one of a handful of stable
 * operations -- if it let the id through, every `GET /nadedb/_doc/<uuid>` would
 * open its own time series in a store shared with another project. That failure
 * does not surface as an error; it surfaces months later as a metrics bill.
 *
 * The duration bookkeeping is the other half: start times are held in a Map
 * keyed by request id, and an entry that is never deleted is a leak in a
 * long-running process.
 */
const histogramRecords: { value: number; attrs: Record<string, unknown> }[] = [];
vi.mock('@config/telemetry', () => ({
  getMeter: () => ({
    createHistogram: () => ({
      record: (value: number, attrs: Record<string, unknown>) => histogramRecords.push({ value, attrs }),
    }),
  }),
}));

const activeSpan: { updateName: ReturnType<typeof vi.fn>; setAttribute: ReturnType<typeof vi.fn> } = {
  updateName: vi.fn(),
  setAttribute: vi.fn(),
};
/** Whether a span is currently active; outside a traced request there is none. */
let hasActiveSpan = true;
vi.mock('@opentelemetry/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@opentelemetry/api')>()),
  trace: { getActiveSpan: () => (hasActiveSpan ? activeSpan : undefined) },
}));

const { instrumentElasticsearchClient } = await import('@app/middleware/esInstrumentation');
const { INDEX_NAME } = await import('@config/elasticsearch');

/** A client double exposing just the diagnostic channel the instrumentation hooks. */
function makeClient() {
  const diagnostic = new EventEmitter();
  const transport: Record<PropertyKey, unknown> = {};
  // The real transport carries this symbol; the instrumentation flips its value
  // to stop the client emitting its own HTTP spans underneath ours.
  const otelSymbol = Symbol('opentelemetry options');
  transport[otelSymbol] = { enabled: true, suppressInternalInstrumentation: false };

  const client = { diagnostic, transport } as never;
  instrumentElasticsearchClient(client);
  return { client, diagnostic, transport, otelSymbol };
}

/** Fires a request/response pair and returns the recorded metric attributes. */
function roundTrip(
  diagnostic: EventEmitter,
  params: { method?: string; path: string; body?: string },
  opts: { id?: number; statusCode?: number; error?: Error } = {},
) {
  const id = opts.id ?? 1;
  const result = {
    meta: { request: { id, params: { method: 'GET', ...params } } },
    statusCode: opts.statusCode ?? 200,
  };
  diagnostic.emit('request', null, result);
  diagnostic.emit('response', opts.error ?? null, result);
  return histogramRecords.at(-1);
}

beforeEach(() => {
  histogramRecords.length = 0;
  activeSpan.updateName.mockReset();
  activeSpan.setAttribute.mockReset();
  hasActiveSpan = true;
});

describe('operation naming', () => {
  it.each([
    ['/nadedb/_search', 'GET', 'search'],
    ['/nadedb/_msearch', 'POST', 'msearch'],
    ['/_bulk', 'POST', 'bulk'],
    ['/nadedb/_count', 'GET', 'count'],
  ])('%s is recorded as %s', (path, method, expected) => {
    const { diagnostic } = makeClient();

    expect(roundTrip(diagnostic, { path, method })?.attrs['db.operation.name']).toBe(expected);
  });

  it.each([
    ['POST', '/nadedb/_doc', 'index'],
    ['POST', '/nadedb/_doc/', 'index'],
    ['PUT', '/nadedb/_doc/abc-123', 'index'],
    ['DELETE', '/nadedb/_doc/abc-123', 'delete'],
    ['GET', '/nadedb/_doc/abc-123', 'get'],
  ])('%s %s is recorded as %s', (method, path, expected) => {
    // These are the ones carrying a document id, which is exactly what must not
    // reach a metric label.
    const { diagnostic } = makeClient();

    expect(roundTrip(diagnostic, { path, method })?.attrs['db.operation.name']).toBe(expected);
  });

  it('never lets a document id into the operation label', () => {
    const { diagnostic } = makeClient();

    const attrs = roundTrip(diagnostic, { path: '/nadedb/_doc/segment-uuid-9f3a', method: 'GET' })?.attrs;

    expect(String(attrs?.['db.operation.name'])).not.toContain('9f3a');
  });

  it('ignores the query string, which varies per request', () => {
    // `?refresh=wait_for` on one bulk and not another would otherwise be two
    // different operations.
    const { diagnostic } = makeClient();

    expect(roundTrip(diagnostic, { path: '/nadedb/_search?scroll=1m' })?.attrs['db.operation.name']).toBe('search');
  });

  it('caps an unrecognised path, so a long one cannot become a long label', () => {
    const { diagnostic } = makeClient();

    const name = String(
      roundTrip(diagnostic, { path: `/nadedb/${'x'.repeat(500)}`, method: 'GET' })?.attrs['db.operation.name'],
    );

    expect(name.length).toBeLessThanOrEqual(50);
  });

  it('falls back to method and path for something it does not recognise', () => {
    const { diagnostic } = makeClient();

    expect(roundTrip(diagnostic, { path: '/nadedb/_refresh', method: 'POST' })?.attrs['db.operation.name']).toBe(
      'post /nadedb/_refresh',
    );
  });
});

describe('the span', () => {
  it('is renamed after the operation and the index it touched', () => {
    // A span called `POST` tells you nothing; `search nadedb` tells you which
    // query is slow.
    const { diagnostic } = makeClient();

    diagnostic.emit('request', null, {
      meta: { request: { id: 1, params: { method: 'GET', path: '/nadedb/_search' } } },
    });

    expect(activeSpan.updateName).toHaveBeenCalledWith('search nadedb');
  });

  it('is named by the operation alone when no index is in the path', () => {
    const { diagnostic } = makeClient();

    diagnostic.emit('request', null, { meta: { request: { id: 1, params: { method: 'POST', path: '/_bulk' } } } });

    expect(activeSpan.updateName).toHaveBeenCalledWith('bulk');
  });

  it('does not mistake an underscore path segment for an index name', () => {
    const { diagnostic } = makeClient();

    diagnostic.emit('request', null, {
      meta: { request: { id: 1, params: { method: 'GET', path: '/_cluster/health' } } },
    });

    expect(activeSpan.updateName).toHaveBeenCalledWith('get /_cluster/health');
  });

  it('carries the query body, which is what makes a slow span diagnosable', () => {
    const { diagnostic } = makeClient();
    const body = JSON.stringify({ query: { match: { content_ja: '食べる' } } });

    diagnostic.emit('request', null, {
      meta: { request: { id: 1, params: { method: 'POST', path: '/nadedb/_search', body } } },
    });

    expect(activeSpan.setAttribute).toHaveBeenCalledWith('db.statement', body);
  });

  it('truncates a large body rather than putting a megabyte on a span', () => {
    // A bulk index body is the whole batch.
    const { diagnostic } = makeClient();

    diagnostic.emit('request', null, {
      meta: { request: { id: 1, params: { method: 'POST', path: '/_bulk', body: 'x'.repeat(5000) } } },
    });

    const recorded = String(activeSpan.setAttribute.mock.calls[0][1]);
    expect(recorded).toHaveLength(2048 + 3);
    expect(recorded.endsWith('...')).toBe(true);
  });

  it('does not set a statement for a body that is not a string', () => {
    const { diagnostic } = makeClient();

    diagnostic.emit('request', null, {
      meta: { request: { id: 1, params: { method: 'POST', path: '/nadedb/_search', body: { query: {} } } } },
    });

    expect(activeSpan.setAttribute).not.toHaveBeenCalled();
  });

  it('does nothing when there is no active span to rename', () => {
    // Background work -- the sync worker, a warm-up query -- runs outside a
    // request trace.
    hasActiveSpan = false;
    const { diagnostic } = makeClient();

    expect(() =>
      diagnostic.emit('request', null, {
        meta: { request: { id: 1, params: { method: 'GET', path: '/nadedb/_search' } } },
      }),
    ).not.toThrow();
  });

  it('still times the request when there is no span', () => {
    // The metric does not depend on tracing being on.
    hasActiveSpan = false;
    const { diagnostic } = makeClient();

    expect(roundTrip(diagnostic, { path: '/nadedb/_search' })).toBeDefined();
  });
});

describe('the duration metric', () => {
  it('carries the attributes a dashboard groups by', () => {
    const { diagnostic } = makeClient();

    const attrs = roundTrip(diagnostic, { path: '/nadedb/_search' })?.attrs;

    expect(attrs).toMatchObject({
      'db.system.name': 'elasticsearch',
      'db.operation.name': 'search',
      'db.namespace': INDEX_NAME,
      'server.address': expect.any(String),
      'server.port': expect.any(Number),
    });
  });

  it('records a non-negative duration', () => {
    const { diagnostic } = makeClient();

    expect(roundTrip(diagnostic, { path: '/nadedb/_search' })?.value).toBeGreaterThanOrEqual(0);
  });

  it('records the status code, so a 4xx is tellable from a 5xx', () => {
    const { diagnostic } = makeClient();

    expect(
      roundTrip(diagnostic, { path: '/nadedb/_search' }, { statusCode: 429 })?.attrs['db.response.status_code'],
    ).toBe('429');
  });

  it('labels a failure by its error class', () => {
    const { diagnostic } = makeClient();
    const error = Object.assign(new Error('timeout'), { name: 'TimeoutError' });

    expect(roundTrip(diagnostic, { path: '/nadedb/_search' }, { error })?.attrs['error.type']).toBe('TimeoutError');
  });

  it('labels an unnamed failure rather than leaving the attribute empty', () => {
    const { diagnostic } = makeClient();
    const error = Object.assign(new Error('boom'), { name: '' });

    expect(roundTrip(diagnostic, { path: '/nadedb/_search' }, { error })?.attrs['error.type']).toBe(
      'elasticsearch_error',
    );
  });

  it('does not tag a successful request with an error type', () => {
    const { diagnostic } = makeClient();

    expect(roundTrip(diagnostic, { path: '/nadedb/_search' })?.attrs).not.toHaveProperty('error.type');
  });

  it('records nothing for a response whose request was never seen', () => {
    // Half a pair, which is what a client-side abort produces. Timing it from
    // an absent start would record garbage.
    const { diagnostic } = makeClient();

    diagnostic.emit('response', null, { meta: { request: { id: 99, params: { method: 'GET', path: '/x' } } } });

    expect(histogramRecords).toHaveLength(0);
  });

  it('records nothing for a response with no result at all', () => {
    const { diagnostic } = makeClient();

    diagnostic.emit('response', new Error('connection refused'), null);

    expect(histogramRecords).toHaveLength(0);
  });

  it('times concurrent requests independently', () => {
    // Keying on the request id is what makes this safe; a single shared start
    // time would attribute the first request's duration to the last one.
    const { diagnostic } = makeClient();
    const req = (id: number, path: string) => ({
      meta: { request: { id, params: { method: 'GET', path } } },
      statusCode: 200,
    });

    diagnostic.emit('request', null, req(1, '/nadedb/_search'));
    diagnostic.emit('request', null, req(2, '/nadedb/_count'));
    diagnostic.emit('response', null, req(2, '/nadedb/_count'));
    diagnostic.emit('response', null, req(1, '/nadedb/_search'));

    expect(histogramRecords.map((r) => r.attrs['db.operation.name'])).toEqual(['count', 'search']);
  });

  it('forgets a request once it has been timed, so the map does not grow forever', () => {
    // The process runs for weeks and every query passes through here.
    const { diagnostic } = makeClient();
    roundTrip(diagnostic, { path: '/nadedb/_search' }, { id: 7 });

    diagnostic.emit('response', null, {
      meta: { request: { id: 7, params: { method: 'GET', path: '/nadedb/_search' } } },
      statusCode: 200,
    });

    expect(histogramRecords).toHaveLength(1);
  });
});

describe('internal span suppression', () => {
  it('stops the client emitting its own HTTP spans underneath ours', () => {
    // Without this every Elasticsearch call produces a second, less useful span
    // for the raw HTTP request, doubling the trace for no added information.
    const { transport, otelSymbol } = makeClient();

    expect(transport[otelSymbol]).toMatchObject({ enabled: true, suppressInternalInstrumentation: true });
  });

  it('is a no-op on a transport that does not carry the option', () => {
    // The symbol is a client internal, so a version bump can move or drop it;
    // that must not stop the metrics being wired up.
    const diagnostic = new EventEmitter();

    expect(() => instrumentElasticsearchClient({ diagnostic, transport: {} } as never)).not.toThrow();

    histogramRecords.length = 0;
    expect(roundTrip(diagnostic, { path: '/nadedb/_search' })).toBeDefined();
  });
});
