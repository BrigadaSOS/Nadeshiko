import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const { warn } = vi.hoisted(() => ({ warn: vi.fn() }));
vi.mock('~~/server/utils/logger', () => ({ logger: { warn, error: vi.fn(), info: vi.fn() } }));
vi.mock('~~/server/utils/shirabeService', () => ({ shirabeServiceToken: vi.fn().mockResolvedValue('service-token') }));

const config = { shirabeApiBase: 'https://shirabe.org', shirabeApiDirect: 'http://100.64.0.5:3000' };
vi.stubGlobal('useRuntimeConfig', () => config);

import { callShirabe, __testing } from './shirabeCall';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

function read(client: Parameters<Parameters<typeof callShirabe>[0]['clientCall']>[0]) {
  return client.identifyWord({ text: '猫', target: { startOffset: 0 } }, { headers: { 'accept-language': 'en' } });
}

const ask = () => callShirabe({ subject: '猫', accessToken: 'reader-token', clientCall: read });
const origins = () => fetchMock.mock.calls.map(([request]) => (request as Request).url);

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-22T12:00:00Z'));
  config.shirabeApiBase = 'https://shirabe.org';
  config.shirabeApiDirect = 'http://100.64.0.5:3000';
  __testing.breaker.openUntil = 0;
  __testing.breaker.consecutiveFailures = 0;
  fetchMock.mockResolvedValue(Response.json({ ok: true }));
});

afterEach(() => vi.useRealTimers());

describe('the SDK lookup transport', () => {
  test('uses the shared service bearer when no reader token is supplied', async () => {
    await callShirabe({ subject: '猫', clientCall: read });

    const request = fetchMock.mock.calls[0]?.[0] as Request;
    expect(request.headers.get('authorization')).toBe('Bearer service-token');
  });

  test('uses the generated client with the reader bearer on the tailnet first', async () => {
    await callShirabe({ subject: '猫', accessToken: 'reader-token', clientCall: read });

    const request = fetchMock.mock.calls[0]?.[0] as Request;
    expect(request.url).toBe('http://100.64.0.5:3000/api/v1/identify');
    expect(request.headers.get('authorization')).toBe('Bearer reader-token');
    expect(request.headers.get('accept-language')).toBe('en');
  });

  test('uses the public origin when the direct route refuses the request', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response('no', { status: 403 }))
      .mockResolvedValueOnce(Response.json({ ok: true }));

    await callShirabe({ subject: '猫', accessToken: 'reader-token', clientCall: read });

    expect((fetchMock.mock.calls[1][0] as Request).url).toBe('https://shirabe.org/api/v1/identify');
    expect(warn).toHaveBeenCalledOnce();
  });

  test('keeps a JSON 404 authoritative rather than masking it with another origin', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 404, headers: { 'content-type': 'application/json' } }));

    await expect(callShirabe({ subject: '猫', accessToken: 'reader-token', clientCall: read })).rejects.toMatchObject({
      response: expect.objectContaining({ status: 404 }),
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test('does not probe the tailnet when it was not configured', async () => {
    config.shirabeApiDirect = '';

    await ask();

    expect(origins()).toEqual(['https://shirabe.org/api/v1/identify']);
  });

  test('replays the SDK-created JSON body intact on the fallback origin', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response('no', { status: 503 }))
      .mockResolvedValueOnce(Response.json({ ok: true }));

    await ask();

    const fallback = fetchMock.mock.calls[1]?.[0] as Request;
    expect(await fallback.json()).toEqual({ text: '猫', target: { startOffset: 0 } });
    expect(fallback.headers.get('content-type')).toContain('application/json');
  });
});

describe('the tailnet circuit breaker', () => {
  async function trip() {
    fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED')).mockResolvedValueOnce(Response.json({ ok: true }));
    await ask();
    fetchMock.mockClear();
    fetchMock.mockResolvedValue(Response.json({ ok: true }));
  }

  test('parks a failing direct path so the next lookup goes public immediately', async () => {
    await trip();

    await ask();

    expect(origins()).toEqual(['https://shirabe.org/api/v1/identify']);
  });

  test('re-probes after its cooldown and resets when the direct path recovers', async () => {
    await trip();

    vi.setSystemTime(new Date('2026-09-22T12:00:31Z'));
    await ask();

    expect(origins()).toEqual(['http://100.64.0.5:3000/api/v1/identify']);
    expect(__testing.breaker).toEqual({ openUntil: 0, consecutiveFailures: 0 });
  });

  test('backs off further after consecutive direct failures', async () => {
    await trip();
    expect(__testing.breaker.openUntil).toBe(Date.now() + __testing.BREAKER_BASE_MS);

    vi.setSystemTime(new Date('2026-09-22T12:00:31Z'));
    fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED')).mockResolvedValueOnce(Response.json({ ok: true }));
    await ask();

    expect(__testing.breaker.openUntil).toBe(Date.now() + __testing.BREAKER_BASE_MS * 2);
  });
});
