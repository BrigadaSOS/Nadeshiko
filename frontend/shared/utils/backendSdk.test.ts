// Assert outgoing headers: missing proxy trust or wrong service credentials can still return successful data.
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

// Only the request matters here; SDK response validation is not the subject.

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
    // Authorization grants corpus access; the proxy secret independently identifies internal traffic.
    const headers = await callSegment({
      backendInternalUrl: baseURL,
      nadeshikoApiKey: 'nade_test',
      internalProxySecret: 'shared-secret-value',
    });

    expect(headers.authorization).toBe('Bearer nade_test');
    expect(headers['x-internal-proxy-auth']).toBe('shared-secret-value');
  });
});

// Inspect credentials on the request: a master key can make private reads succeed when they should be refused.
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
    // Public browsing uses service quota; bearer auth takes precedence over the reader cookie.
    const headers = await callSegment(config(), {
      publicRoutes: PUBLIC_ROUTES,
      cookie: 'nadeshiko.session_token=reader-token',
    });

    expect(headers.authorization).toBe('Bearer nade_master_key');
    expect(headers.cookie).toBeUndefined();
  });

  test('fails closed when no allowlist is supplied: no key on anything', async () => {
    const headers = await callSegment(config(), {});

    expect(headers.authorization).toBeUndefined();
  });

  test('sends no credential at all for an anonymous visitor on an owner-scoped route', async () => {
    const headers = await callCollection(config(), { publicRoutes: PUBLIC_ROUTES, cookie: '' });

    expect(headers.authorization).toBeUndefined();
    expect(headers.cookie).toBeUndefined();
  });

  test('matches allowlist paths by segment, not by prefix', async () => {
    const matches = createPublicRouteMatcher(PUBLIC_ROUTES);

    expect(matches('POST', '/v1/search')).toBe(true);
    expect(matches('post', '/v1/search')).toBe(true);
    expect(matches('POST', '/v1/searching')).toBe(false);
    expect(matches('GET', '/v1/search')).toBe(false);
    expect(matches('GET', '/v1/media/segments/abc')).toBe(true);
    expect(matches('GET', '/v1/media/segments/abc/extra')).toBe(false);
  });
});
