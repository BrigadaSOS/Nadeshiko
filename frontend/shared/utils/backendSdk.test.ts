/**
 * The internal SDK's job is not just to reach the backend but to be *recognised*
 * by it. A client that talks to the right URL and omits the shared secret still
 * works in every functional sense -- it returns the right data in development
 * and in any test that only asserts on the response -- and then collapses the
 * whole site's server-side rendering into one 300/min per-IP bucket the moment
 * production gets busy. That failure is invisible until it is an outage, so the
 * headers are asserted here directly.
 */
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createInternalSdk, createPublicRouteMatcher } from './backendSdk';

let server: Server;
let baseURL: string;
let lastHeaders: IncomingHttpHeaders = {};

beforeAll(async () => {
  server = createServer((req, res) => {
    lastHeaders = req.headers;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ publicId: 'seg_1' }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseURL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

/** The SDK unwraps and validates responses; only the request matters here. */
/** `/v1/media/segments/{id}` is on the public allowlist; `getSegment` calls it. */
const PUBLIC_ROUTES = [
  { method: 'GET', path: '/v1/media/segments/{segmentPublicId}' },
  { method: 'POST', path: '/v1/search' },
];

async function callSegment(
  config: Parameters<typeof createInternalSdk>[0],
  options: Parameters<typeof createInternalSdk>[1] = { publicRoutes: PUBLIC_ROUTES },
) {
  lastHeaders = {};
  const sdk = createInternalSdk(config, options);
  await sdk.getSegment('seg_1').catch(() => undefined);
  return lastHeaders;
}

/** `/v1/collections/{id}` is deliberately NOT on the allowlist. */
async function callCollection(
  config: Parameters<typeof createInternalSdk>[0],
  options: Parameters<typeof createInternalSdk>[1] = { publicRoutes: PUBLIC_ROUTES },
) {
  lastHeaders = {};
  const sdk = createInternalSdk(config, options);
  await sdk.getCollection({ collectionPublicId: 'coll_1' }).catch(() => undefined);
  return lastHeaders;
}

describe('createInternalSdk', () => {
  test('stamps the internal-proxy secret so the backend exempts SSR from its per-IP limiter', async () => {
    const headers = await callSegment({
      backendInternalUrl: baseURL,
      nadeshikoApiKey: 'nade_test',
      internalProxySecret: 'shared-secret-value',
    });

    expect(headers['x-internal-proxy-auth']).toBe('shared-secret-value');
  });

  test('sends no secret header when none is configured, rather than an empty one', async () => {
    // An empty header is worse than none: the backend compares it against the
    // configured secret in constant time, so a blank value is a failed match
    // that looks, in a log, exactly like a wrong one.
    const headers = await callSegment({
      backendInternalUrl: baseURL,
      nadeshikoApiKey: 'nade_test',
    });

    expect(headers['x-internal-proxy-auth']).toBeUndefined();
  });

  test('treats a whitespace-only secret as unset', async () => {
    const headers = await callSegment({
      backendInternalUrl: baseURL,
      nadeshikoApiKey: 'nade_test',
      internalProxySecret: '   ',
    });

    expect(headers['x-internal-proxy-auth']).toBeUndefined();
  });

  test('still carries the service API key, which authorizes the call the secret does not', async () => {
    // The two headers answer different questions -- "may this caller read the
    // corpus" and "is this caller us" -- and an earlier version of this client
    // sent only the first.
    const headers = await callSegment({
      backendInternalUrl: baseURL,
      nadeshikoApiKey: 'nade_test',
      internalProxySecret: 'shared-secret-value',
    });

    expect(headers.authorization).toBe('Bearer nade_test');
    expect(headers['x-internal-proxy-auth']).toBe('shared-secret-value');
  });
});

/**
 * The security-critical half. These assert on the REQUEST, because response-level
 * tests cannot see this bug: with the master key attached everything succeeds, and
 * succeeds harder — the key's account is seeded `role: ADMIN`, so the backend
 * hands over collections it should refuse. That is exactly how a server render
 * came to serve private collections to anonymous visitors at HTTP 200.
 */
describe('createInternalSdk credential routing', () => {
  const config = () => ({
    backendInternalUrl: baseURL,
    nadeshikoApiKey: 'nade_master_key',
    internalProxySecret: 'shared-secret-value',
  });

  test('signs an allowlisted route with the master key', async () => {
    const headers = await callSegment(config(), { publicRoutes: PUBLIC_ROUTES });

    expect(headers.authorization).toBe('Bearer nade_master_key');
  });

  test('never sends the master key on a route off the allowlist', async () => {
    const headers = await callCollection(config(), { publicRoutes: PUBLIC_ROUTES });

    expect(headers.authorization).toBeUndefined();
  });

  test('sends the reader’s cookie instead, on a route off the allowlist', async () => {
    const headers = await callCollection(config(), {
      publicRoutes: PUBLIC_ROUTES,
      cookie: 'nadeshiko.session_token=reader-token',
    });

    expect(headers.cookie).toBe('nadeshiko.session_token=reader-token');
    expect(headers.authorization).toBeUndefined();
  });

  test('does NOT send the cookie on an allowlisted route, so public traffic stays service-signed', async () => {
    // A signed-in reader searching still spends the service identity, which is
    // what keeps ordinary browsing out of their per-account quota. Sending both
    // would also be useless: `requireAuth` branches on the bearer header first.
    const headers = await callSegment(config(), {
      publicRoutes: PUBLIC_ROUTES,
      cookie: 'nadeshiko.session_token=reader-token',
    });

    expect(headers.authorization).toBe('Bearer nade_master_key');
    expect(headers.cookie).toBeUndefined();
  });

  test('fails closed when no allowlist is supplied: no key on anything', async () => {
    // The default. A caller that forgets to pass `publicRoutes` gets a client that
    // authenticates as nobody — a 401 — rather than one that authenticates as an
    // admin.
    const headers = await callSegment(config(), {});

    expect(headers.authorization).toBeUndefined();
  });

  test('sends no credential at all for an anonymous visitor on an owner-scoped route', async () => {
    const headers = await callCollection(config(), { publicRoutes: PUBLIC_ROUTES, cookie: '' });

    expect(headers.authorization).toBeUndefined();
    expect(headers.cookie).toBeUndefined();
  });

  test('matches allowlist paths by segment, not by prefix', async () => {
    // `/v1/searching` must not inherit `/v1/search`\'s key.
    const matches = createPublicRouteMatcher(PUBLIC_ROUTES);

    expect(matches('POST', '/v1/search')).toBe(true);
    expect(matches('post', '/v1/search')).toBe(true);
    expect(matches('POST', '/v1/searching')).toBe(false);
    expect(matches('GET', '/v1/search')).toBe(false);
    expect(matches('GET', '/v1/media/segments/abc')).toBe(true);
    expect(matches('GET', '/v1/media/segments/abc/extra')).toBe(false);
  });
});
