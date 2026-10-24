import { beforeEach, describe, expect, it, vi } from 'vitest';

const { proxyToBackend, enforceIpRateLimit } = vi.hoisted(() => ({
  proxyToBackend: vi.fn(),
  enforceIpRateLimit: vi.fn(),
}));

vi.mock('~~/server/utils/backendProxy', () => ({ proxyToBackend }));
vi.mock('~~/server/utils/v1ProxyPolicy', async (importOriginal) => ({
  // Keep the real bucket choice and path checks; only the limiter itself is observed.
  ...(await importOriginal<typeof import('~~/server/utils/v1ProxyPolicy')>()),
  enforceIpRateLimit,
}));
vi.mock('h3', async (importOriginal) => {
  const actual = await importOriginal<typeof import('h3')>();
  return { ...actual, getRequestURL: (event: FakeEvent) => event.url };
});

vi.stubGlobal('defineEventHandler', (handler: unknown) => handler);

type FakeEvent = { url: URL; node: { req: { method: string; url: string } } };
const handler = (await import('./[...path]')).default as (event: FakeEvent) => Promise<unknown>;

function request(path: string, method: string) {
  return handler({ url: new URL(`https://nadeshiko.co${path}`), node: { req: { method, url: path } } });
}

const { v1ApiLimit, v1AuthLimit, v1FeedbackLimit } = await import('~~/server/utils/v1ProxyPolicy');

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

describe('the browser /v1 proxy rate-limit bucket', () => {
  beforeEach(() => {
    enforceIpRateLimit.mockReset();
    proxyToBackend.mockReset();
  });

  // Express routes these to the feedback handler; Nitro's case-sensitive exact route does not see them.
  it.each(['/v1/Feedback', '/v1/feedback/', '/v1/FEEDBACK//'])(
    'charges POST %s to the feedback bucket',
    async (path) => {
      await request(path, 'POST');
      expect(enforceIpRateLimit).toHaveBeenCalledWith(expect.anything(), v1FeedbackLimit);
    },
  );

  it('charges a feedback-token read to the general bucket', async () => {
    await request('/v1/feedback/', 'GET');
    expect(enforceIpRateLimit).toHaveBeenCalledWith(expect.anything(), v1ApiLimit);
  });

  it('charges a case-varied auth path to the auth bucket', async () => {
    await request('/v1/Auth/sign-in/magic-link', 'POST');
    expect(enforceIpRateLimit).toHaveBeenCalledWith(expect.anything(), v1AuthLimit);
  });

  it('charges a path that resolves to feedback to the feedback bucket before refusing it', async () => {
    await expect(request('/v1/x/%2e%2e/feedback', 'POST')).rejects.toMatchObject({ statusCode: 400 });
    expect(enforceIpRateLimit).toHaveBeenCalledWith(expect.anything(), v1FeedbackLimit);
  });

  it.each(['/v1/%2e%2e/feedback', '/v1/auth/.%2E/feedback', '/v1/search/%2E', '/v1/a/%2e%2e%2ffeedback'])(
    'refuses the dot-segment path %s without proxying',
    async (path) => {
      await expect(request(path, 'POST')).rejects.toMatchObject({ statusCode: 400 });
      expect(proxyToBackend).not.toHaveBeenCalled();
    },
  );
});
