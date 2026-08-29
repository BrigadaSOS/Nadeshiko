import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * Lifting an address off ZeptoMail's OWN suppression list.
 *
 * The whole reason this exists is that there are two lists. Auto-suppression of
 * hard bounces is on at the Agent, deliberately, so ZeptoMail refuses an address
 * whether or not our webhook is healthy -- which means deleting our row clears
 * only our half. The app then believes it can write to that person while the
 * relay silently still refuses, and nothing anywhere reports the disagreement.
 *
 * So the return value is a claim about the RELAY, and every case below is about
 * whether that claim is honest. Reporting success when the relay is still
 * refusing is the failure that matters; reporting failure when it is not
 * refusing costs an operator an afternoon hunting a problem that does not exist.
 */
const overrides: Record<string, unknown> = {};

vi.mock('@config/config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@config/config')>();
  return {
    ...actual,
    config: new Proxy(
      { ...actual.config },
      { get: (target, key) => (key in overrides ? overrides[key as string] : target[key as keyof typeof target]) },
    ),
  };
});

const logWarn = vi.fn();
vi.mock('@config/log', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@config/log')>();
  return { ...actual, logger: { ...actual.logger, warn: (...a: unknown[]) => logWarn(...a) } };
});

const { deleteProviderSuppression, isZohoConfigured, resetTokenCache } = await import(
  '@app/services/email/zeptomailApi'
);

const ADDRESS = 'reader@example.com';

/** Credentials a working deployment has. */
const CONFIGURED = {
  ZOHO_CLIENT_ID: 'client-1',
  ZOHO_CLIENT_SECRET: 'secret-1',
  ZOHO_REFRESH_TOKEN: 'refresh-1',
  ZOHO_ACCOUNTS_HOST: 'accounts.zoho.com',
  ZEPTOMAIL_API_HOST: 'api.zeptomail.com',
};

function configure(values: Record<string, unknown> = CONFIGURED) {
  for (const key of Object.keys(overrides)) delete overrides[key];
  Object.assign(overrides, values);
}

/** A Zoho token-exchange response. */
function tokenResponse(accessToken: string | null = 'tok-1', status = 200) {
  return new Response(
    JSON.stringify(accessToken === null ? { error: 'invalid_grant' } : { access_token: accessToken }),
    {
      status,
    },
  );
}

/** A ZeptoMail suppression-delete response. */
function deleteResponse(status: number, body: unknown = {}) {
  return new Response(JSON.stringify(body), { status });
}

/** ZeptoMail's "the address was not on the list" answer. */
const NOT_FOUND_BODY = { error: { code: 'DND_102' } };

/** Queues fetch outcomes in order and records where each one went. */
function queueFetch(...outcomes: (Response | Error)[]) {
  const fetchMock = vi.fn();
  for (const outcome of outcomes) {
    if (outcome instanceof Error) fetchMock.mockRejectedValueOnce(outcome);
    else fetchMock.mockResolvedValueOnce(outcome);
  }
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

beforeEach(() => {
  resetTokenCache();
  logWarn.mockReset();
  configure();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('isZohoConfigured', () => {
  it('is true when all three credentials are present', () => {
    expect(isZohoConfigured()).toBe(true);
  });

  it.each(['ZOHO_CLIENT_ID', 'ZOHO_CLIENT_SECRET', 'ZOHO_REFRESH_TOKEN'])('is false without %s', (missing) => {
    configure({ ...CONFIGURED, [missing]: undefined });

    expect(isZohoConfigured()).toBe(false);
  });
});

describe('without credentials', () => {
  it('reports failure rather than a lift that never happened', () => {
    // The address really is still refused at the relay. A `true` here would
    // make the operator's lift exit zero while the person still cannot be
    // written to.
    configure({ ...CONFIGURED, ZOHO_CLIENT_ID: undefined });

    return expect(deleteProviderSuppression(ADDRESS)).resolves.toBe(false);
  });

  it('says out loud what has to be done by hand', async () => {
    configure({ ...CONFIGURED, ZOHO_CLIENT_ID: undefined });

    await deleteProviderSuppression(ADDRESS);

    expect(String(logWarn.mock.calls[0][0])).toMatch(/ZeptoMail console/);
  });

  it('does not reach the network at all', async () => {
    configure({ ...CONFIGURED, ZOHO_REFRESH_TOKEN: undefined });
    const fetchMock = queueFetch();

    await deleteProviderSuppression(ADDRESS);

    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('the delete request', () => {
  it('reports success when ZeptoMail removed the address', async () => {
    queueFetch(tokenResponse(), deleteResponse(200));

    expect(await deleteProviderSuppression(ADDRESS)).toBe(true);
  });

  it('sends the address as an ARRAY, which is the shape ZeptoMail accepts', async () => {
    // `{ value: "..." }` -- the obvious reading, and what shirabe shipped --
    // comes back as `SERR_110 "Parameter less than min occurrance"` naming a
    // field the request never sent, which reads like a server problem.
    const fetchMock = queueFetch(tokenResponse(), deleteResponse(200));

    await deleteProviderSuppression(ADDRESS);

    const [, init] = fetchMock.mock.calls[1];
    expect(JSON.parse(init.body)).toEqual({ values: [ADDRESS] });
  });

  it('sends a DELETE with the OAuth token', async () => {
    const fetchMock = queueFetch(tokenResponse('tok-abc'), deleteResponse(200));

    await deleteProviderSuppression(ADDRESS);

    const [url, init] = fetchMock.mock.calls[1];
    expect(url).toContain('/v1.1/suppressions/email');
    expect(init.method).toBe('DELETE');
    expect(init.headers.Authorization).toBe('Zoho-oauthtoken tok-abc');
  });

  it('gives up rather than hanging when the relay stops answering', async () => {
    // This runs from an operator's terminal; a request with no deadline is one
    // they have to interrupt themselves.
    const fetchMock = queueFetch(tokenResponse(), deleteResponse(200));

    await deleteProviderSuppression(ADDRESS);

    expect(fetchMock.mock.calls[1][1].signal).toBeInstanceOf(AbortSignal);
  });
});

describe('"not on the list" is success', () => {
  it('treats DND_102 as a lift that is already done', async () => {
    // The goal is that ZeptoMail is not refusing the address. If it never had
    // the address -- we suppressed it manually, or auto-suppression had not
    // fired -- that goal is already met, and reporting failure sends somebody
    // hunting for a problem that does not exist.
    queueFetch(tokenResponse(), deleteResponse(404, NOT_FOUND_BODY));

    expect(await deleteProviderSuppression(ADDRESS)).toBe(true);
  });

  it('does not treat every 404 as success, only the one that says so', async () => {
    queueFetch(tokenResponse(), deleteResponse(404, { error: { code: 'SERR_999' } }));

    expect(await deleteProviderSuppression(ADDRESS)).toBe(false);
  });

  it('does not mistake an unparseable body for "not on the list"', async () => {
    // An HTML error page from a proxy is not a claim about the address.
    queueFetch(tokenResponse(), new Response('<html>502</html>', { status: 502 }));

    expect(await deleteProviderSuppression(ADDRESS)).toBe(false);
  });
});

describe('an expired token', () => {
  it('is retried once with a fresh one', async () => {
    // The cache holds a token for fifty minutes against a stated hour, but the
    // clock that matters is Zoho's -- an unlucky boundary should not read as a
    // failed lift.
    queueFetch(tokenResponse('stale'), deleteResponse(401), tokenResponse('fresh'), deleteResponse(200));

    expect(await deleteProviderSuppression(ADDRESS)).toBe(true);
  });

  it('the retry uses the new token, not the rejected one', async () => {
    const fetchMock = queueFetch(
      tokenResponse('stale'),
      deleteResponse(401),
      tokenResponse('fresh'),
      deleteResponse(200),
    );

    await deleteProviderSuppression(ADDRESS);

    expect(fetchMock.mock.calls[3][1].headers.Authorization).toBe('Zoho-oauthtoken fresh');
  });

  it('accepts "not on the list" on the retry too', async () => {
    queueFetch(
      tokenResponse('stale'),
      deleteResponse(401),
      tokenResponse('fresh'),
      deleteResponse(404, NOT_FOUND_BODY),
    );

    expect(await deleteProviderSuppression(ADDRESS)).toBe(true);
  });

  it('reports failure when the retry is refused as well', async () => {
    queueFetch(tokenResponse('stale'), deleteResponse(401), tokenResponse('fresh'), deleteResponse(401));

    expect(await deleteProviderSuppression(ADDRESS)).toBe(false);
  });

  it('reports failure when a fresh token cannot be got either', async () => {
    queueFetch(tokenResponse('stale'), deleteResponse(401), tokenResponse(null, 400));

    expect(await deleteProviderSuppression(ADDRESS)).toBe(false);
  });

  it('retries only once, rather than looping on a permanently rejected token', async () => {
    const fetchMock = queueFetch(
      tokenResponse('stale'),
      deleteResponse(401),
      tokenResponse('fresh'),
      deleteResponse(401),
    );

    await deleteProviderSuppression(ADDRESS);

    expect(fetchMock).toHaveBeenCalledTimes(4);
  });
});

describe('other refusals', () => {
  it.each([400, 403, 429, 500])('reports failure on a %d', async (status) => {
    queueFetch(tokenResponse(), deleteResponse(status));

    expect(await deleteProviderSuppression(ADDRESS)).toBe(false);
  });

  it('records the status, so the failure can be told apart afterwards', async () => {
    queueFetch(tokenResponse(), deleteResponse(429));

    await deleteProviderSuppression(ADDRESS);

    expect(logWarn).toHaveBeenCalledWith({ status: 429 }, expect.stringContaining('refused'));
  });

  it('reports failure, rather than throwing, when ZeptoMail is unreachable', async () => {
    // The caller is a CLI an operator runs; a rejected promise there is a stack
    // trace instead of a sentence.
    queueFetch(tokenResponse(), new Error('ECONNRESET'));

    expect(await deleteProviderSuppression(ADDRESS)).toBe(false);
  });
});

describe('the token exchange', () => {
  it('asks Zoho for a token using the refresh grant', async () => {
    const fetchMock = queueFetch(tokenResponse(), deleteResponse(200));

    await deleteProviderSuppression(ADDRESS);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain('/oauth/v2/token');
    expect(String(init.body)).toContain('grant_type=refresh_token');
    expect(String(init.body)).toContain('refresh_token=refresh-1');
  });

  it('is done once for a burst of lifts, not once each', async () => {
    // A handful of lifts a year, but an operator forgiving a list of addresses
    // does them back to back.
    const fetchMock = queueFetch(tokenResponse(), deleteResponse(200), deleteResponse(200), deleteResponse(200));

    await deleteProviderSuppression('a@example.com');
    await deleteProviderSuppression('b@example.com');
    await deleteProviderSuppression('c@example.com');

    const tokenCalls = fetchMock.mock.calls.filter(([url]) => String(url).includes('/oauth/v2/token'));
    expect(tokenCalls).toHaveLength(1);
  });

  it('reports failure when the exchange is refused', async () => {
    queueFetch(tokenResponse(null, 400));

    expect(await deleteProviderSuppression(ADDRESS)).toBe(false);
  });

  it('treats a 200 with no token as a failure', async () => {
    // Zoho answers 200 with an `error` field for a revoked refresh token, so a
    // successful status is not on its own evidence that we hold a token.
    queueFetch(tokenResponse(null, 200));

    expect(await deleteProviderSuppression(ADDRESS)).toBe(false);
  });

  it('reports failure when the accounts host is unreachable', async () => {
    queueFetch(new Error('getaddrinfo ENOTFOUND'));

    expect(await deleteProviderSuppression(ADDRESS)).toBe(false);
  });

  it('does not attempt the delete when there is no token', async () => {
    const fetchMock = queueFetch(tokenResponse(null, 401));

    await deleteProviderSuppression(ADDRESS);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
