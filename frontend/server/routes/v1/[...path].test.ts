import { describe, expect, it, vi } from 'vitest';

const { proxyToBackend, enforceIpRateLimit } = vi.hoisted(() => ({
  proxyToBackend: vi.fn(),
  enforceIpRateLimit: vi.fn(),
}));

vi.mock('~~/server/utils/backendProxy', () => ({ proxyToBackend }));
vi.mock('~~/server/utils/v1ProxyPolicy', () => ({ enforceIpRateLimit, v1ApiLimit: {} }));
vi.mock('h3', async (importOriginal) => {
  const actual = await importOriginal<typeof import('h3')>();
  return { ...actual, getRequestURL: (event: FakeEvent) => event.url };
});

vi.stubGlobal('defineEventHandler', (handler: unknown) => handler);

type FakeEvent = { url: URL; node: { req: { method: string } } };
const handler = (await import('./[...path]')).default as (event: FakeEvent) => Promise<unknown>;

function request(path: string, method: string) {
  return handler({ url: new URL(`https://nadeshiko.co${path}`), node: { req: { method } } });
}

describe('the browser /v1 proxy server-only boundary', () => {
  it.each([
    ['GET', '/v1/user/connections/shirabe/credential/'],
    ['HEAD', '/v1/user/connections/shirabe/CREDENTIAL'],
  ])('returns 403 and never proxies %s %s', async (method, path) => {
    await expect(request(path, method)).rejects.toMatchObject({ statusCode: 403 });
    expect(proxyToBackend).not.toHaveBeenCalled();
  });

  it('still proxies an ordinary route', async () => {
    proxyToBackend.mockResolvedValueOnce({ ok: true });
    await expect(request('/v1/search', 'POST')).resolves.toEqual({ ok: true });
    expect(proxyToBackend).toHaveBeenCalledOnce();
  });
});
