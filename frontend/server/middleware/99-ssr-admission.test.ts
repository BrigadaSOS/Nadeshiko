import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, test, vi } from 'vitest';

/**
 * The render admission gate, driven through the real handler with h3's globals
 * stubbed, the way search-redirect.test.ts drives its middleware.
 *
 * The property under test is the one that decides whether a flood takes the
 * site down: past the cap the middleware ends the request itself, cheaply,
 * with a 503 the client can act on -- and it gives the slot back whether the
 * response finished or the client hung up.
 */
process.env.NUXT_SSR_MAX_INFLIGHT = '2';

type FakeEvent = {
  method: string;
  url: URL;
  headers: Record<string, string>;
  status?: number;
  responseHeaders: Record<string, string>;
  node: { res: EventEmitter };
};

vi.stubGlobal('defineEventHandler', (fn: unknown) => fn);
vi.stubGlobal('getRequestURL', (event: FakeEvent) => event.url);
vi.stubGlobal('getRequestHeader', (event: FakeEvent, name: string) => event.headers[name.toLowerCase()]);
vi.stubGlobal('setResponseStatus', (event: FakeEvent, status: number) => {
  event.status = status;
});
vi.stubGlobal('setResponseHeader', (event: FakeEvent, name: string, value: string) => {
  event.responseHeaders[name.toLowerCase()] = value;
});

const handler = (await import('./99-ssr-admission')).default as (event: FakeEvent) => unknown;

function makeEvent(path: string, method = 'GET', headers: Record<string, string> = {}): FakeEvent {
  return {
    method,
    url: new URL(`https://nadeshiko.co${path}`),
    headers,
    responseHeaders: {},
    node: { res: new EventEmitter() },
  };
}

/** Admits a render and returns the event, whose response is still open. */
function admit(path = '/en/search/word'): FakeEvent {
  const event = makeEvent(path);
  expect(handler(event)).toBeUndefined();
  return event;
}

describe('99-ssr-admission', () => {
  beforeEach(() => {
    // Whatever the previous test left in flight is released by ending its
    // responses; the gate is module state, so this is the only way to reset it.
  });

  test('refuses the render past the cap with a 503 the client can act on', () => {
    const first = admit();
    const second = admit();

    const refused = makeEvent('/en/search/another');
    const body = handler(refused);
    expect(refused.status).toBe(503);
    expect(refused.responseHeaders['retry-after']).toBe('2');
    expect(refused.responseHeaders['cache-control']).toBe('no-store');
    expect(refused.responseHeaders['x-nd-admission']).toBe('refused');
    expect(typeof body).toBe('string');

    first.node.res.emit('finish');
    first.node.res.emit('close');
    second.node.res.emit('close');
  });

  test('a finished response gives its slot back', () => {
    const first = admit();
    const second = admit();
    first.node.res.emit('finish');
    first.node.res.emit('close');

    const third = makeEvent('/en/search/third');
    expect(handler(third)).toBeUndefined();
    expect(third.status).toBeUndefined();

    second.node.res.emit('close');
    third.node.res.emit('close');
  });

  test('a client that hangs up gives its slot back too', () => {
    const aborted = admit();
    const second = admit();
    aborted.node.res.emit('close');

    const next = makeEvent('/en/search/next');
    expect(handler(next)).toBeUndefined();

    second.node.res.emit('close');
    next.node.res.emit('close');
  });

  test('counts HEAD with GET, since Nitro renders the page for both', () => {
    const first = admit();
    const head = makeEvent('/en/search/word', 'HEAD');
    expect(handler(head)).toBeUndefined();

    const refused = makeEvent('/en/sentence/abc');
    handler(refused);
    expect(refused.status).toBe(503);

    first.node.res.emit('close');
    head.node.res.emit('close');
  });

  test.each(['/v1/search/stats', '/api/announcement', '/_nuxt/entry.js', '/up', '/sitemap.xml'])(
    'never gates %s, which is not a render',
    (path) => {
      const first = admit();
      const second = admit();

      const passthrough = makeEvent(path);
      expect(handler(passthrough)).toBeUndefined();
      expect(passthrough.status).toBeUndefined();

      first.node.res.emit('close');
      second.node.res.emit('close');
    },
  );

  test('does not gate writes: a POST is never a page render', () => {
    const first = admit();
    const second = admit();

    const post = makeEvent('/en/search/word', 'POST');
    expect(handler(post)).toBeUndefined();
    expect(post.status).toBeUndefined();

    first.node.res.emit('close');
    second.node.res.emit('close');
  });
});
