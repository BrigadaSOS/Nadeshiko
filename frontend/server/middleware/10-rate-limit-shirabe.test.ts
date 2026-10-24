import { describe, expect, it, vi, beforeEach } from 'vitest';

const { enforceIpRateLimit } = vi.hoisted(() => ({ enforceIpRateLimit: vi.fn() }));
vi.mock('~~/server/utils/v1ProxyPolicy', () => ({ enforceIpRateLimit, shirabeLookupLimit: { route: 'api.shirabe' } }));
vi.mock('h3', async (importOriginal) => ({
  ...(await importOriginal<typeof import('h3')>()),
  getRequestURL: (event: { url: URL }) => event.url,
}));
vi.stubGlobal('defineEventHandler', (fn: unknown) => fn);

const handler = (await import('./10-rate-limit-shirabe')).default as (event: { url: URL }) => Promise<void>;
const visit = (path: string) => handler({ url: new URL(`https://nadeshiko.co${path}`) });

beforeEach(() => enforceIpRateLimit.mockReset());

describe('the Shirabe lookup rate limit', () => {
  it('counts word-card lookups', async () => {
    await visit('/api/shirabe/words/candidates/%E5%85%84?locale=en&junk=1');
    expect(enforceIpRateLimit).toHaveBeenCalledWith(expect.anything(), { route: 'api.shirabe' });
  });

  it.each(['/api/announcement', '/en/search/neko', '/api/shirabe'])('leaves %s alone', async (path) => {
    await visit(path);
    expect(enforceIpRateLimit).not.toHaveBeenCalled();
  });
});
