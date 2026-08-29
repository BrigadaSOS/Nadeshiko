import { describe, test, expect, beforeEach, vi } from 'vitest';

/**
 * The Nitro error hook, which decides three things that are each invisible when
 * wrong.
 *
 * WHAT REACHES POSTHOG. This deliberately does not use
 * `enableExceptionAutocapture`, which sends everything that reaches this hook --
 * every 404 h3 throws, every crawler probing `/wp-login.php` -- against a fresh
 * uuid that traces back to nobody. The slice worth ingesting is 5xx from
 * readers, and both halves of that test live here.
 *
 * WHO IT IS ATTRIBUTED TO. An SSR exception is the one failure the browser
 * cannot report -- the render died before any JS shipped -- so reading
 * posthog-js's own cookie is the only way it lands on the same person as their
 * pageviews. That cookie is client-controlled, so a malformed one must cost the
 * attribution and never the report.
 *
 * WHAT IS IN THE LOG LINE. Credentials must not be: the session cookie, the
 * bearer token and the internal proxy secret all arrive as ordinary headers.
 */
const counterAdds: { value: number; attrs: Record<string, unknown> }[] = [];
vi.mock('@opentelemetry/api', () => ({
  metrics: {
    getMeter: () => ({
      createCounter: () => ({
        add: (value: number, attrs: Record<string, unknown>) => counterAdds.push({ value, attrs }),
      }),
    }),
  },
}));

const captureException = vi.fn();
const shutdown = vi.fn().mockResolvedValue(undefined);
vi.mock('posthog-node', () => ({
  PostHog: class {
    captureException = captureException;
    shutdown = shutdown;
  },
}));

const logLines: { level: string; payload: Record<string, unknown>; message: string }[] = [];
vi.mock('../utils/logger', () => ({
  createLogger: () => ({
    info: (payload: Record<string, unknown>, message: string) => logLines.push({ level: 'info', payload, message }),
    warn: (payload: Record<string, unknown>, message: string) => logLines.push({ level: 'warn', payload, message }),
    error: (payload: Record<string, unknown>, message: string) => logLines.push({ level: 'error', payload, message }),
  }),
}));

/** Which class the request was resolved as. Set per test. */
let traffic: 'reader' | 'bot' | 'monitor' = 'reader';
vi.mock('#shared/utils/traffic', () => ({
  resolveEventTraffic: () => ({ traffic, family: traffic === 'bot' ? 'googlebot' : undefined }),
  trafficAttributes: (t: string, family?: string) => ({ traffic: t, ...(family ? { 'bot.family': family } : {}) }),
}));

vi.mock('~~/route-normalization.mjs', () => ({ normalizeRoute: (url: string) => url.split('?')[0] }));

const POSTHOG_KEY = 'phc_test';
let posthogConfigured = true;

type Hook = (...args: any[]) => unknown;

/** Boots the plugin and returns a way to fire its hooks. */
async function loadPlugin() {
  vi.resetModules();
  const hooks = new Map<string, Hook[]>();
  vi.stubGlobal('defineNitroPlugin', (fn: (app: unknown) => void) => fn);
  vi.stubGlobal('useRuntimeConfig', () => ({
    public: {
      posthog: posthogConfigured ? { publicKey: POSTHOG_KEY, host: 'https://t.nadeshiko.co' } : undefined,
      appVersion: '2.4.12',
    },
  }));

  const plugin = (await import('./errorHandler')).default as (app: unknown) => void;
  plugin({
    hooks: {
      hook(name: string, fn: Hook) {
        hooks.set(name, [...(hooks.get(name) ?? []), fn]);
      },
    },
  });

  return async (name: string, ...args: unknown[]) => {
    for (const fn of hooks.get(name) ?? []) await fn(...args);
  };
}

/** A request event, with whatever cookie header the test wants read back. */
function makeEvent(
  overrides: {
    url?: string;
    method?: string;
    status?: number;
    cookie?: string;
    headers?: Record<string, unknown>;
  } = {},
) {
  return {
    context: {} as Record<string, unknown>,
    node: {
      req: {
        url: overrides.url ?? '/en/search/neko',
        method: overrides.method ?? 'GET',
        headers: {
          host: 'nadeshiko.co',
          ...(overrides.cookie ? { cookie: overrides.cookie } : {}),
          ...overrides.headers,
        },
      },
      res: { statusCode: overrides.status ?? 200 },
    },
  };
}

/** An error carrying an HTTP status, the way h3 throws them. */
function httpError(statusCode: number, message = 'boom') {
  return Object.assign(new Error(message), { statusCode });
}

beforeEach(() => {
  vi.clearAllMocks();
  counterAdds.length = 0;
  logLines.length = 0;
  traffic = 'reader';
  posthogConfigured = true;
  // h3's `getCookie` reads `event.node.req.headers.cookie`, which the events
  // above provide, so the real implementation is used.
  vi.stubGlobal('crypto', { randomUUID: () => 'req-uuid-1' });
});

describe('what gets reported to PostHog', () => {
  test('a 5xx from a reader is captured -- the slice worth paying to ingest', async () => {
    const fire = await loadPlugin();

    await fire('error', httpError(500), { event: makeEvent(), tags: ['request'] });

    expect(captureException).toHaveBeenCalledTimes(1);
  });

  test.each([404, 400, 429, 499])('a %d is not, because it is the caller’s own doing', async (status) => {
    const fire = await loadPlugin();

    await fire('error', httpError(status), { event: makeEvent(), tags: ['request'] });

    expect(captureException).not.toHaveBeenCalled();
  });

  test.each(['bot', 'monitor'] as const)('a 5xx from %s traffic is not captured', async (kind) => {
    // Bots outnumber readers on exactly the URL shapes that throw.
    traffic = kind;
    const fire = await loadPlugin();

    await fire('error', httpError(500), { event: makeEvent(), tags: ['request'] });

    expect(captureException).not.toHaveBeenCalled();
  });

  test('a process-level fault with no event is always captured', async () => {
    // `uncaughtException` and `unhandledRejection` come through here with no
    // request attached, and they always matter -- the render process is now
    // suspect for every request it goes on to serve.
    const fire = await loadPlugin();

    await fire('error', new Error('unhandled'), { tags: ['uncaughtException'] });

    expect(captureException).toHaveBeenCalledTimes(1);
  });

  test('an error with no status at all is treated as a 500', async () => {
    const fire = await loadPlugin();

    await fire('error', new Error('plain'), { event: makeEvent(), tags: ['request'] });

    expect(captureException).toHaveBeenCalled();
  });

  test('nothing is sent when PostHog is not configured, as outside production', async () => {
    posthogConfigured = false;
    const fire = await loadPlugin();

    await fire('error', httpError(500), { event: makeEvent(), tags: ['request'] });

    expect(captureException).not.toHaveBeenCalled();
  });

  test('a failure to report never breaks error handling', async () => {
    // The log line and the counter have already been emitted by this point; a
    // throw here would replace a handled 500 with an unhandled one.
    captureException.mockImplementation(() => {
      throw new Error('posthog down');
    });
    const fire = await loadPlugin();

    await expect(fire('error', httpError(500), { event: makeEvent(), tags: ['request'] })).resolves.toBeUndefined();
    expect(logLines.some((l) => l.level === 'warn')).toBe(true);
  });
});

describe('who the exception is attributed to', () => {
  /** posthog-js's own cookie, whose name and shape are theirs, not ours. */
  function phCookie(value: object) {
    return `ph_${POSTHOG_KEY}_posthog=${encodeURIComponent(JSON.stringify(value))}`;
  }

  test('lands on the same person as that reader’s pageviews', async () => {
    const fire = await loadPlugin();

    await fire('error', httpError(500), {
      event: makeEvent({ cookie: phCookie({ distinct_id: 'person-1' }) }),
      tags: ['request'],
    });

    expect(captureException.mock.calls[0][1]).toBe('person-1');
  });

  test('ties the exception to the session recording when there is one', async () => {
    // `$sesid` is `[lastActivityTs, sessionId, startTs]`; only the id is useful.
    const fire = await loadPlugin();

    await fire('error', httpError(500), {
      event: makeEvent({ cookie: phCookie({ distinct_id: 'person-1', $sesid: [1, 'sess-9', 0] }) }),
      tags: ['request'],
    });

    expect(captureException.mock.calls[0][2].$session_id).toBe('sess-9');
  });

  test('does not manufacture a person out of a request id when there is no cookie', async () => {
    const fire = await loadPlugin();

    await fire('error', httpError(500), { event: makeEvent(), tags: ['request'] });

    expect(captureException.mock.calls[0][2].$process_person_profile).toBe(false);
  });

  test.each([
    ['not JSON at all', 'not-json'],
    ['JSON of the wrong shape', JSON.stringify({ distinct_id: 12345 })],
    ['a session id that is not a string', JSON.stringify({ distinct_id: 'p', $sesid: [1, 2, 3] })],
  ])('a cookie that is %s costs the attribution, never the report', async (_name, raw) => {
    // Client-controlled input, so every read is treated as hostile.
    const fire = await loadPlugin();

    await fire('error', httpError(500), {
      event: makeEvent({ cookie: `ph_${POSTHOG_KEY}_posthog=${encodeURIComponent(raw)}` }),
      tags: ['request'],
    });

    expect(captureException).toHaveBeenCalledTimes(1);
    expect(captureException.mock.calls[0][2].$session_id).toBeUndefined();
  });
});

describe('the exception payload', () => {
  test('carries the same fingerprint as the metric, so the two confirm each other', async () => {
    // Left to itself PostHog groups by exception type and stack, which for SSR
    // means grouping by minified chunk path -- it would not line up with the
    // counter, and neither could then confirm the other.
    const fire = await loadPlugin();

    await fire('error', httpError(500), { event: makeEvent(), tags: ['request'] });

    const sent = captureException.mock.calls[0][2].$exception_fingerprint;
    expect(sent).toBe(counterAdds[0].attrs['error.fingerprint']);
  });

  test('names the request and the service version', async () => {
    const fire = await loadPlugin();

    await fire('error', httpError(503), { event: makeEvent({ url: '/en/search/neko?page=2' }), tags: ['request'] });

    expect(captureException.mock.calls[0][2]).toMatchObject({
      'http.method': 'GET',
      'http.status_code': 503,
      'http.url': '/en/search/neko?page=2',
      'http.route': '/en/search/neko',
      'service.name': 'nadeshiko-frontend',
      'service.version': '2.4.12',
    });
  });

  test('carries nitro’s own word for where the error came from', async () => {
    // The only thing separating an SSR render failure from a cache write that
    // threw.
    const fire = await loadPlugin();

    await fire('error', httpError(500), { event: makeEvent(), tags: ['cache', 'plugin'] });

    expect(captureException.mock.calls[0][2]['nitro.tags']).toBe('cache,plugin');
  });
});

describe('the exception counter', () => {
  test('separates 5xx from 4xx, which are different mornings', async () => {
    const fire = await loadPlugin();

    await fire('error', httpError(500), { event: makeEvent(), tags: [] });
    await fire('error', httpError(404), { event: makeEvent(), tags: [] });

    expect(counterAdds.map((c) => c.attrs['error.severity'])).toEqual(['5xx', '4xx']);
  });

  test('counts 4xx even though it does not report them', async () => {
    // A burst of 404s is worth seeing on a graph; it is not worth an issue.
    const fire = await loadPlugin();

    await fire('error', httpError(404), { event: makeEvent(), tags: [] });

    expect(counterAdds).toHaveLength(1);
    expect(captureException).not.toHaveBeenCalled();
  });

  test('records which traffic class the burst came from', async () => {
    traffic = 'bot';
    const fire = await loadPlugin();

    await fire('error', httpError(500), { event: makeEvent(), tags: [] });

    expect(counterAdds[0].attrs).toMatchObject({ traffic: 'bot', 'bot.family': 'googlebot' });
  });

  test('groups by the error type and the first frame that is ours', async () => {
    // Frames in node_modules and node internals are skipped: grouping on them
    // would put every library-thrown error in one bucket.
    const error = new TypeError('nope');
    error.stack = [
      'TypeError: nope',
      '    at Object.get (node:internal/foo:1:1)',
      '    at load (/app/node_modules/vue/index.mjs:2:2)',
      '    at render (/app/server/routes/search.ts:10:5)',
    ].join('\n');
    const fire = await loadPlugin();

    await fire('error', error, { event: makeEvent(), tags: [] });

    expect(counterAdds[0].attrs['error.fingerprint']).toBe('TypeError:/app/server/routes/search.ts');
  });

  test('falls back to `unknown` rather than a random frame when nothing is ours', async () => {
    const error = new Error('nope');
    error.stack = 'Error: nope\n    at load (/app/node_modules/vue/index.mjs:2:2)';
    const fire = await loadPlugin();

    await fire('error', error, { event: makeEvent(), tags: [] });

    expect(counterAdds[0].attrs['error.fingerprint']).toBe('Error:unknown');
  });

  test('caps the group label, so a long message cannot become its own series', async () => {
    const fire = await loadPlugin();

    await fire('error', new Error('x'.repeat(400)), { event: makeEvent(), tags: [] });

    expect(String(counterAdds[0].attrs['error.group'])).toHaveLength(120);
  });
});

describe('the request log', () => {
  test('logs one line per response, carrying the status and duration', async () => {
    const fire = await loadPlugin();
    const event = makeEvent({ status: 200 });

    await fire('request', event);
    await fire('afterResponse', event);

    expect(logLines.at(-1)).toMatchObject({ level: 'info', payload: { type: 'response', statusCode: 200 } });
  });

  test.each([
    [200, 'info'],
    [404, 'warn'],
    [500, 'error'],
  ])('a %d is logged at %s', async (status, level) => {
    const fire = await loadPlugin();
    const event = makeEvent({ status });

    await fire('request', event);
    await fire('afterResponse', event);

    expect(logLines.at(-1)?.level).toBe(level);
  });

  test('tags every request with an id that the exception report also carries', async () => {
    const fire = await loadPlugin();
    const event = makeEvent({ status: 500 });

    await fire('request', event);
    await fire('error', httpError(500), { event, tags: [] });

    expect(captureException.mock.calls[0][2].request_id).toBe('req-uuid-1');
  });

  test('classifies the traffic on the line, so it is a filter and not a User-Agent grep', async () => {
    traffic = 'bot';
    const fire = await loadPlugin();
    const event = makeEvent();

    await fire('request', event);
    await fire('afterResponse', event);

    expect(logLines.at(-1)?.payload).toMatchObject({ traffic: 'bot', 'bot.family': 'googlebot' });
  });
});

describe('credentials in the error log', () => {
  test.each(['cookie', 'authorization', 'proxy-authorization', 'x-internal-proxy-auth', 'x-api-key'])(
    'redacts %s',
    async (header) => {
      const fire = await loadPlugin();

      await fire('error', httpError(500), {
        event: makeEvent({ headers: { [header]: 'secret-value' } }),
        tags: [],
      });

      const logged = JSON.stringify(logLines.find((l) => l.payload.type === 'error')?.payload.req);
      expect(logged).not.toContain('secret-value');
      expect(logged).toContain('[REDACTED]');
    },
  );

  test('redacts regardless of the case the header arrived in', async () => {
    const fire = await loadPlugin();

    await fire('error', httpError(500), { event: makeEvent({ headers: { Authorization: 'secret-value' } }), tags: [] });

    expect(JSON.stringify(logLines.find((l) => l.payload.type === 'error')?.payload.req)).not.toContain('secret-value');
  });

  test('keeps the ordinary headers, which is what makes the line useful', async () => {
    const fire = await loadPlugin();

    await fire('error', httpError(500), { event: makeEvent({ headers: { 'user-agent': 'Mozilla/5.0' } }), tags: [] });

    expect(JSON.stringify(logLines.find((l) => l.payload.type === 'error')?.payload.req)).toContain('Mozilla/5.0');
  });
});

describe('shutdown', () => {
  test('flushes on close, because an unflushed batch is the report you wanted', async () => {
    // Nitro flushes nothing on its own, and the interesting bursts arrive
    // during a bad deploy -- exactly when the container is about to go.
    const fire = await loadPlugin();

    await fire('close');

    expect(shutdown).toHaveBeenCalled();
  });
});
