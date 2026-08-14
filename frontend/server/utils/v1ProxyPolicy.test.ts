import { describe, expect, it, vi, beforeEach } from 'vitest';

const { env } = vi.hoisted(() => ({ env: { NUXT_RATE_LIMIT_BYPASS_SECRET: '' } }));
const { ipRateLimit } = vi.hoisted(() => ({ ipRateLimit: vi.fn() }));

vi.mock('~~/config/env', () => ({ env }));
vi.mock('~~/server/utils/ipRateLimit', () => ({ ipRateLimit }));

const { enforceIpRateLimit, v1ApiLimit } = await import('./v1ProxyPolicy');

const SECRET = 'PxK2s9Qw4mVb7Ld1Rt6Yz0Nh3Jf8Ac5';
const eventWith = (header?: string) =>
  ({ node: { req: { headers: header === undefined ? {} : { 'x-rate-limit-bypass': header } } } }) as never;

beforeEach(() => {
  ipRateLimit.mockReset();
  env.NUXT_RATE_LIMIT_BYPASS_SECRET = '';
});

/**
 * The `/v1` limiter's half of the bypass. The HTML limiter had this door and
 * this one did not, which is what left the end-to-end suite throttled: a run
 * spends far more requests on `/v1` than on renders, and running out showed up
 * as `/v1/search/stats` returning 429 while the results call beside it
 * succeeded -- a page with results, no category tabs and no media sidebar.
 */
describe('enforceIpRateLimit', () => {
  it('counts the request when no secret is configured, whatever is offered', async () => {
    ipRateLimit.mockResolvedValue(undefined);

    await enforceIpRateLimit(eventWith(SECRET), v1ApiLimit);

    // The state production is in: the door does not exist, so the limiter runs.
    expect(ipRateLimit).toHaveBeenCalledTimes(1);
  });

  it('skips the limiter for a caller holding the configured secret', async () => {
    env.NUXT_RATE_LIMIT_BYPASS_SECRET = SECRET;
    ipRateLimit.mockResolvedValue(undefined);

    await enforceIpRateLimit(eventWith(SECRET), v1ApiLimit);

    expect(ipRateLimit).not.toHaveBeenCalled();
  });

  it('still counts a caller offering the wrong secret, or none', async () => {
    env.NUXT_RATE_LIMIT_BYPASS_SECRET = SECRET;
    ipRateLimit.mockResolvedValue(undefined);

    await enforceIpRateLimit(eventWith('not-the-secret'), v1ApiLimit);
    await enforceIpRateLimit(eventWith(undefined), v1ApiLimit);

    expect(ipRateLimit).toHaveBeenCalledTimes(2);
  });

  it('throws what the limiter returns, so the caller answers 429', async () => {
    const tooMany = Object.assign(new Error('Too Many Requests'), { statusCode: 429 });
    ipRateLimit.mockResolvedValue(tooMany);

    await expect(enforceIpRateLimit(eventWith(undefined), v1ApiLimit)).rejects.toBe(tooMany);
  });
});
