import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * The one way to reach Shirabe, and the circuit breaker in front of it.
 *
 * Two pieces here have already cost real outages, and both are invisible from
 * the outside:
 *
 * THE `/api/v1` PREFIX. Shirabe mounts its JSON API under it. Without it every
 * lookup hit Rails' catch-all and came back 404 -- which reads as "this word has
 * no entry", a real and common answer. So every word card rendered empty and it
 * looked like thin dictionary coverage. Nothing alerted, because an empty card
 * is not an error. `describeFailure` exists to tell those two 404s apart, and it
 * uses the CONTENT TYPE rather than the status, because the status cannot.
 *
 * THE FALLBACK'S SCOPE. The direct path is a tailnet shortcut, and it can be
 * reachable but WRONG -- a 403 from host authorization, a 401 from a key it will
 * not take. Treating those as authoritative turned a misconfigured shortcut into
 * 502s for readers while the public host would have answered perfectly well.
 * Only a 404 is about the subject; everything else falls back.
 */
// `vi.hoisted`, because the factory below is hoisted above every other
// statement in this file and would otherwise close over an uninitialised `warn`.
const { warn } = vi.hoisted(() => ({ warn: vi.fn() }));
vi.mock('~~/server/utils/logger', () => ({ logger: { warn, error: vi.fn(), info: vi.fn() } }));

const fetchMock = vi.fn();
vi.stubGlobal('$fetch', fetchMock);

const config = {
  shirabeApiBase: 'https://shirabe.org',
  shirabeApiDirect: 'http://100.64.0.5:3000',
  shirabeApiKey: 'service-key',
};
vi.stubGlobal('useRuntimeConfig', () => config);

import { callShirabe, describeFailure, __testing } from './shirabeCall';

const NOW = new Date('2026-08-31T12:00:00Z');

/** An error shaped like the one `$fetch` throws for an HTTP status. */
function httpError(status: number, contentType = 'application/json') {
  return {
    response: { status, headers: { get: (key: string) => (key === 'content-type' ? contentType : null) } },
  };
}

/** Which origin each call went to, in order. */
const origins = () => fetchMock.mock.calls.map(([url]) => String(url));

const ask = () => callShirabe({ path: '/words/identify', subject: 'word:食べる' });

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  config.shirabeApiBase = 'https://shirabe.org';
  config.shirabeApiDirect = 'http://100.64.0.5:3000';
  config.shirabeApiKey = 'service-key';
  // Module state, and a breaker left open by one test would send the next one
  // straight to the public host.
  __testing.breaker.openUntil = 0;
  __testing.breaker.consecutiveFailures = 0;
  fetchMock.mockResolvedValue({ ok: true });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('the request itself', () => {
  test('asks under /api/v1, which is where Shirabe mounts its API', async () => {
    // Without the prefix every lookup hits Rails' catch-all and 404s, and a 404
    // reads as "no entry for this word" -- so the whole dictionary looked thin
    // and nothing alerted.
    await ask();

    expect(origins()[0]).toBe('http://100.64.0.5:3000/api/v1/words/identify');
  });

  test('authenticates with our service key', async () => {
    await ask();

    expect(fetchMock.mock.calls[0]![1]).toMatchObject({ headers: { authorization: 'Bearer service-key' } });
  });

  test('asks as the READER when they have linked their own account', async () => {
    // Shirabe shapes a lookup by the dictionary stack of whoever's key made the
    // call, which is the entire point of linking.
    await callShirabe({ path: '/words/identify', subject: 'w', apiKey: 'reader-key' });

    expect(fetchMock.mock.calls[0]![1]).toMatchObject({ headers: { authorization: 'Bearer reader-key' } });
  });

  test('falls back to ours when the reader’s key is blank', async () => {
    await callShirabe({ path: '/words/identify', subject: 'w', apiKey: '   ' });

    expect(fetchMock.mock.calls[0]![1]).toMatchObject({ headers: { authorization: 'Bearer service-key' } });
  });

  test('refuses to call at all with no service key configured', async () => {
    // It is what answers for every anonymous lookup and every failed one, so
    // without it the feature is not configured rather than degraded.
    config.shirabeApiKey = '';

    await expect(ask()).rejects.toMatchObject({ statusCode: 503 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('does not double the slash between origin and path', async () => {
    config.shirabeApiDirect = 'http://100.64.0.5:3000/';

    await ask();

    expect(origins()[0]).toBe('http://100.64.0.5:3000/api/v1/words/identify');
  });

  test('passes the method, query and body through', async () => {
    await callShirabe({ path: '/words/lookup', subject: 'w', method: 'POST', query: { a: '1' }, body: { b: 2 } });

    expect(fetchMock.mock.calls[0]![1]).toMatchObject({ method: 'POST', query: { a: '1' }, body: { b: 2 } });
  });
});

describe('the tailnet shortcut', () => {
  test('is tried first, because the public name goes Helsinki → Cloudflare → Helsinki', async () => {
    await ask();

    expect(origins()).toEqual(['http://100.64.0.5:3000/api/v1/words/identify']);
  });

  test('gets a SHORT timeout, so a dead shortcut does not eat the reader’s budget', async () => {
    await ask();

    expect(fetchMock.mock.calls[0]![1]).toMatchObject({ timeout: 1500 });
  });

  test('is skipped entirely when none is configured', async () => {
    config.shirabeApiDirect = '';

    await ask();

    expect(origins()).toEqual(['https://shirabe.org/api/v1/words/identify']);
    expect(fetchMock.mock.calls[0]![1]).toMatchObject({ timeout: 5000 });
  });

  test('hands the answer back when it works', async () => {
    fetchMock.mockResolvedValue({ word: '食べる' });

    expect(await ask()).toEqual({ word: '食べる' });
  });
});

describe('when the shortcut fails', () => {
  test('the public host answers instead, so the reader still gets a card', async () => {
    // A word popup that fails is worse than a slow one; the tailnet is one more
    // thing that can be down.
    fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED')).mockResolvedValueOnce({ word: '食べる' });

    expect(await ask()).toEqual({ word: '食べる' });
    expect(origins()[1]).toBe('https://shirabe.org/api/v1/words/identify');
  });

  test.each([403, 401, 500, 502])('a %i falls back, since it is about the PATH and not the word', async (status) => {
    // A 403 is host authorization rejecting the tailnet address, a 401 a key it
    // will not take. Treating either as authoritative turned a misconfigured
    // shortcut into 502s for readers.
    fetchMock.mockRejectedValueOnce(httpError(status)).mockResolvedValueOnce({ word: '食べる' });

    expect(await ask()).toEqual({ word: '食べる' });
  });

  test('but a 404 is rethrown, because that IS the answer about the word', async () => {
    // The path is healthy and the public host would say the same thing a round
    // trip later.
    fetchMock.mockRejectedValueOnce(httpError(404));

    await expect(ask()).rejects.toMatchObject({ response: { status: 404 } });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test('a 404 leaves the shortcut in service', async () => {
    fetchMock.mockRejectedValueOnce(httpError(404));
    await expect(ask()).rejects.toBeDefined();

    fetchMock.mockResolvedValue({ ok: true });
    await ask();

    expect(origins()[1]).toContain('100.64.0.5');
  });

  test('says so in the log, with the subject and how long it is parked', async () => {
    fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED')).mockResolvedValueOnce({});

    await ask();

    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ subject: 'word:食べる', cooldownMs: 30_000, failures: 1 }),
      expect.stringContaining('parking'),
    );
  });
});

describe('the circuit breaker', () => {
  /** One failed direct call, which parks the shortcut. */
  async function trip() {
    fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED')).mockResolvedValueOnce({});
    await ask();
    fetchMock.mockClear();
    fetchMock.mockResolvedValue({ ok: true });
  }

  test('parks the shortcut, so the next lookup does not pay the timeout again', async () => {
    // Falling back per request is correct but not enough: with the tailnet down
    // every uncached lookup pays the direct timeout before starting the request
    // that works, and the shortcut makes the feature slower than not having it.
    await trip();

    await ask();

    expect(origins()).toEqual(['https://shirabe.org/api/v1/words/identify']);
  });

  test('probes it again once the cooldown lapses', async () => {
    // That attempt IS the half-open probe, so no separate health check is
    // needed.
    await trip();

    vi.setSystemTime(new Date(NOW.getTime() + 30_001));
    await ask();

    expect(origins()[0]).toContain('100.64.0.5');
  });

  test('and not a moment before', async () => {
    await trip();

    vi.setSystemTime(new Date(NOW.getTime() + 29_000));
    await ask();

    expect(origins()[0]).toContain('shirabe.org');
  });

  test('backs off further with each consecutive failure', async () => {
    // So a real outage costs one slow request every few minutes rather than one
    // per lookup.
    await trip();
    expect(__testing.breaker.openUntil).toBe(NOW.getTime() + 30_000);

    vi.setSystemTime(new Date(NOW.getTime() + 31_000));
    fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED')).mockResolvedValueOnce({});
    await ask();

    expect(__testing.breaker.openUntil).toBe(NOW.getTime() + 31_000 + 60_000);
  });

  test('but never backs off past the ceiling', async () => {
    // Five minutes is long enough to stop costing anything and short enough
    // that a recovered tailnet is noticed the same afternoon.
    const start = NOW.getTime();
    for (let attempt = 0; attempt < 8; attempt++) {
      vi.setSystemTime(new Date(start + attempt * 600_000));
      fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED')).mockResolvedValueOnce({});
      await ask();
    }

    expect(__testing.breaker.openUntil).toBe(start + 7 * 600_000 + 300_000);
  });

  test('one good request restores the shortcut at full speed', async () => {
    // Reset rather than decayed, so the next failure does not escalate from
    // wherever the last outage stopped.
    await trip();
    vi.setSystemTime(new Date(NOW.getTime() + 31_000));
    await ask(); // The probe succeeds.

    expect(__testing.breaker.consecutiveFailures).toBe(0);
    expect(__testing.breaker.openUntil).toBe(0);
  });

  test('and the failure after that starts from the base cooldown again', async () => {
    await trip();
    vi.setSystemTime(new Date(NOW.getTime() + 31_000));
    await ask();

    const later = NOW.getTime() + 100_000;
    vi.setSystemTime(new Date(later));
    fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED')).mockResolvedValueOnce({});
    await ask();

    expect(__testing.breaker.openUntil).toBe(later + 30_000);
  });
});

describe('reading what a failure meant', () => {
  test('a 404 with JSON is the API saying the word has no entry', () => {
    expect(describeFailure(httpError(404, 'application/json'))).toEqual({ kind: 'missing', status: 404 });
  });

  test('a 404 with HTML is Rails’ catch-all saying the ROUTE is wrong', () => {
    // The distinction the empty-card outage turned on. The status is identical;
    // only the content type separates a missing word from a missing route.
    expect(describeFailure(httpError(404, 'text/html; charset=utf-8'))).toEqual({ kind: 'bad-path', status: 404 });
  });

  test('a 404 with no content type at all is read as a missing word', () => {
    // The ordinary case is far more likely than a broken route, and a caller
    // that treats it as one renders an empty card rather than a 500.
    const error = { response: { status: 404, headers: { get: () => null } } };

    expect(describeFailure(error)).toEqual({ kind: 'missing', status: 404 });
  });

  test.each([500, 502, 403])('a %i is a failure, whatever it was serving', (status) => {
    expect(describeFailure(httpError(status))).toEqual({ kind: 'failed', status });
  });

  test('something that is not an HTTP error at all is a failure with no status', () => {
    // A timeout or a DNS error arrives with no response on it.
    expect(describeFailure(new Error('ETIMEDOUT'))).toEqual({ kind: 'failed', status: undefined });
  });
});
