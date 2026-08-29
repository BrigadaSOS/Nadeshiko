import { RPCType } from '@opentelemetry/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The route label on the HTTP server span, for both halves of the traffic.
 *
 * A request that produces a response gets its route from Nitro's
 * `beforeResponse` hook. A request that THROWS never reaches that hook: Nitro's
 * error handler sends the response itself, which sets `event.handled`, and h3's
 * catch block returns before either response hook runs --
 *
 *   if (app.options.onError) await app.options.onError(error, event);
 *   if (event.handled) return;                    // <- both hooks skipped
 *   if (app.options.onBeforeResponse ...
 *
 * -- so every thrown error used to reach the metrics with no `http.route`.
 * Measured in production on 2026-08-29: 123 of 123 frontend 429s (the HTML rate
 * limiter throws) and 464 of 471 404s carried no route label at all.
 */

const rpcMetadata: { type: unknown; route?: string } = { type: undefined };

vi.mock('@opentelemetry/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@opentelemetry/core')>();
  return { ...actual, getRPCMetadata: () => rpcMetadata };
});

type Hook = (...args: any[]) => unknown;

async function loadPlugin() {
  const hooks = new Map<string, Hook[]>();
  const nitroApp = {
    hooks: {
      hook(name: string, fn: Hook) {
        hooks.set(name, [...(hooks.get(name) ?? []), fn]);
      },
    },
  };

  vi.stubGlobal('defineNitroPlugin', (fn: (app: unknown) => void) => fn);
  const plugin = (await import('./00-telemetry')).default as (app: unknown) => void;
  plugin(nitroApp);

  return async (name: string, ...args: unknown[]) => {
    for (const fn of hooks.get(name) ?? []) await fn(...args);
  };
}

function makeEvent(path: string, matchedRoute?: string) {
  return {
    path,
    context: matchedRoute ? { matchedRoute: { path: matchedRoute } } : ({} as Record<string, unknown>),
    node: { req: { url: path, method: 'GET' } },
  };
}

describe('http.route on the server span', () => {
  let fire: (name: string, ...args: unknown[]) => Promise<void>;

  beforeEach(async () => {
    rpcMetadata.type = RPCType.HTTP;
    rpcMetadata.route = undefined;
    vi.resetModules();
    fire = await loadPlugin();
  });

  afterEach(() => {
    // `defineNitroPlugin` is a Nitro auto-import that does not exist under
    // vitest; leaving the stub in place would leak it into every other file
    // sharing this worker.
    vi.unstubAllGlobals();
  });

  it('labels a normal response from beforeResponse', async () => {
    await fire('beforeResponse', makeEvent('/en/sentence/gFH5xlsT--zr'));

    expect(rpcMetadata.route).toBe('/:locale/sentence/:id');
  });

  it('labels a thrown error from the error hook, which beforeResponse never sees', async () => {
    // The shape of a rate-limited page request: the HTML limiter throws before
    // anything matches a route.
    await fire('error', new Error('Too Many Requests'), { event: makeEvent('/ja/media/jujutsu-kaisen') });

    expect(rpcMetadata.route).toBe('/:locale/media/:id');
  });

  it('labels a 404 the same way, rather than leaving it unlabelled', async () => {
    await fire('error', new Error('Not Found'), { event: makeEvent('/en/totally/bogus') });

    expect(rpcMetadata.route).toBe('/__other');
  });

  it('prefers the route Nitro matched over the normalizer guess', async () => {
    await fire('error', new Error('boom'), { event: makeEvent('/en/anything', '/api/blog/posts') });

    expect(rpcMetadata.route).toBe('/api/blog/posts');
  });

  it('falls back to the normalizer when the matched route is a catch-all', async () => {
    // A `[...slug]` match names the file, not the endpoint, so it would collapse
    // unrelated pages onto one label.
    await fire('error', new Error('boom'), { event: makeEvent('/en/sentence/gFH5xlsT--zr', '/**') });

    expect(rpcMetadata.route).toBe('/:locale/sentence/:id');
  });

  it('leaves ignored paths alone in both hooks', async () => {
    const ignored = makeEvent('/_nuxt/entry.js');
    ignored.context._otelIgnored = true;

    await fire('beforeResponse', ignored);
    expect(rpcMetadata.route).toBeUndefined();

    await fire('error', new Error('boom'), { event: ignored });
    expect(rpcMetadata.route).toBeUndefined();
  });

  it('does not throw when the error carries no event', async () => {
    await expect(fire('error', new Error('boom'), {})).resolves.not.toThrow();
    await expect(fire('error', new Error('boom'), undefined)).resolves.not.toThrow();
  });
});
