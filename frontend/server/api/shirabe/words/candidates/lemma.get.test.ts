import { describe, test, expect, beforeEach, vi } from 'vitest';

/**
 * "Which words match this span?", with the definitions attached.
 *
 * It sends source text and UTF-16 target offsets to Shirabe's identify API.
 *
 * Two other things here are load-bearing and invisible:
 *
 *   - A READER'S OWN KEY can fail in ways ours cannot -- revoked, or over a
 *     per-minute budget much smaller than a service identity's -- and the right
 *     answer is the default dictionaries, not a broken card. But the fallback
 *     must not then report the SERVICE stack as the reader's, or the backend is
 *     told their dictionaries changed to ours.
 *   - THE CACHE HEADER. A linked reader's card is built from dictionaries that
 *     are theirs to have configured; a `public` cache anywhere between here and
 *     them would hand it to the next reader through the same hop.
 */
const { logger, callShirabe, readerStack, readerToken, reportShirabeRefusal, reportStackFingerprint } = vi.hoisted(
  () => ({
    logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
    callShirabe: vi.fn(),
    readerStack: vi.fn(),
    readerToken: vi.fn(),
    reportShirabeRefusal: vi.fn(),
    reportStackFingerprint: vi.fn(),
  }),
);
const sharedCache = vi.hoisted(() => ({ calls: 0 }));

vi.mock('~~/server/utils/logger', () => ({ logger }));
vi.mock('~~/server/utils/shirabeCall', () => ({
  callShirabe: (...a: unknown[]) => callShirabe(...a),
}));
vi.mock('~~/server/utils/shirabeReader', () => ({
  readerStack: (...a: unknown[]) => readerStack(...a),
  readerToken: (...a: unknown[]) => readerToken(...a),
  reportShirabeRefusal: (...a: unknown[]) => reportShirabeRefusal(...a),
  reportStackFingerprint: (...a: unknown[]) => reportStackFingerprint(...a),
  readerHasOwnStack: vi.fn(),
}));

type FakeEvent = { params: Record<string, string>; query: Record<string, unknown>; headers: Record<string, string> };

vi.mock('h3', async (importOriginal) => {
  const actual = await importOriginal<typeof import('h3')>();
  return {
    ...actual,
    getRouterParam: (event: FakeEvent, name: string) => event.params[name],
    getQuery: (event: FakeEvent) => event.query,
    setResponseHeader: (event: FakeEvent, name: string, value: string | number) => {
      event.headers[name] = String(value);
    },
  };
});

vi.stubGlobal('defineEventHandler', (handler: unknown) => handler);
vi.stubGlobal('defineCachedEventHandler', (handler: (event: FakeEvent) => unknown) => (event: FakeEvent) => {
  sharedCache.calls += 1;
  return handler(event);
});

const candidate = (over: Record<string, unknown> = {}) => ({
  id: 'jmdict:1',
  headword: '兄',
  reading: 'あに',
  ...over,
});

/** An identify answer with these candidates for the selected span. */
const identified = (candidates: unknown[], stackFingerprint?: string) => ({
  spans: [{ startOffset: 0, matches: candidates }],
  ...(stackFingerprint ? { stackFingerprint } : {}),
});

/** An error shaped the way `$fetch` throws for an HTTP status. */
function httpError(status: number, contentType = 'application/json') {
  return {
    response: { status, headers: { get: (key: string) => (key === 'content-type' ? contentType : null) } },
  };
}

let handler: (event: FakeEvent) => Promise<Record<string, unknown>>;
let lastEvent: FakeEvent | undefined;

/** Asks for one span, returning the response body and headers set on it. */
async function lookup(lemma: string | undefined, query: Record<string, unknown> = {}) {
  handler ??= ((await import('./[lemma].get')) as unknown as { default: typeof handler }).default;
  const event: FakeEvent = {
    params: lemma === undefined ? {} : { lemma },
    query: lemma === undefined ? query : { text: lemma, startOffset: 0, endOffset: lemma.length, ...query },
    headers: {},
  };
  lastEvent = event;
  const body = await handler(event);
  return { body, headers: event.headers };
}

/** The body of the identify request that was sent upstream. */
const asked = () =>
  ({
    ...(callShirabe.mock.calls[0]![0] as { accessToken?: string }),
    ...(sdkPost.mock.calls[0]![0] as {
      headers: Record<string, string>;
      body: { text: string; target: { startOffset: number; endOffset?: number }; dictionaries?: string[] };
    }),
  }) as {
    headers: Record<string, string>;
    body: { text: string; target: { startOffset: number; endOffset?: number }; dictionaries?: string[] };
    accessToken?: string;
  };

const sdkPost = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  sharedCache.calls = 0;
  lastEvent = undefined;
  readerStack.mockResolvedValue({ linked: false, fingerprint: null });
  readerToken.mockResolvedValue(null);
  sdkPost.mockResolvedValue(identified([candidate()]));
  callShirabe.mockImplementation(async (request) => {
    const identify = (body: unknown, options?: { headers?: Record<string, string> }) =>
      sdkPost({ body, headers: options?.headers });
    return await request.clientCall({ identifyWord: identify } as never);
  });
});

describe('the question it asks', () => {
  test('refuses a request with no word in it', async () => {
    await expect(lookup(undefined)).rejects.toMatchObject({ statusCode: 400 });
  });

  test('sends the selected span to identify', async () => {
    await lookup('兄');

    expect(asked().body).toEqual({ text: '兄', target: { startOffset: 0, endOffset: 1 } });
  });

  test('uses sentence context and offsets without POS hints', async () => {
    sdkPost.mockResolvedValue({ spans: [{ startOffset: 2, matches: [candidate()] }] });
    await lookup('開いた', { text: '窓を開いた。', startOffset: 2, endOffset: 5, pos: 'verb' });

    expect(asked().body).toEqual({ text: '窓を開いた。', target: { startOffset: 2, endOffset: 5 } });
  });

  test('rejects an invalid span before calling Shirabe', async () => {
    await expect(lookup('兄', { startOffset: 3 })).rejects.toMatchObject({ statusCode: 400 });
    expect(callShirabe).not.toHaveBeenCalled();
  });

  test('sends the label locale in Accept-Language, not the body', async () => {
    await lookup('兄', { locale: 'es' });

    expect(asked().headers).toEqual(expect.objectContaining({ 'accept-language': 'es' }));
    expect(asked().body.dictionaries).toBeUndefined();
    expect(asked().body).not.toHaveProperty('locale');
  });

  test.each([['fr'], ['ja'], ['../en'], ['']])('clamps an unshipped locale like %s to English', async (locale) => {
    // An arbitrary query string would otherwise multiply the cached copies of a
    // word that is the same for everyone.
    await lookup('兄', { locale });

    expect(asked().headers).toEqual(expect.objectContaining({ 'accept-language': 'en' }));
  });
});

describe('a reader with dictionaries of their own', () => {
  beforeEach(() => {
    readerStack.mockResolvedValue({ linked: true, fingerprint: 'abc' });
    readerToken.mockResolvedValue('reader-key');
  });

  test('is asked for with their key, which is what makes the answer theirs', async () => {
    await lookup('兄');

    expect(asked().accessToken).toBe('reader-key');
    expect(asked().headers).toEqual(expect.objectContaining({ 'accept-language': 'en' }));
    expect(asked().body.dictionaries).toBeUndefined();
  });

  test('gets a PRIVATE cache header, since the card is built from their stack', async () => {
    // A shared cache between here and them would hand their dictionaries to the
    // next reader through the same hop.
    const { headers } = await lookup('兄');

    expect(headers['cache-control']).toContain('private');
    expect(sharedCache.calls).toBe(0);
  });

  test('is told the stack their answer came from, so their client can re-key its cache', async () => {
    callShirabe.mockResolvedValue(identified([candidate()], 'fp-new'));

    const { body } = await lookup('兄');

    expect(body.stackFingerprint).toBe('fp-new');
  });

  test('has a changed stack handed to the backend, without waiting for it', async () => {
    // This request already holds the fresh answer; the update buys the reader's
    // NEXT request being cached under a key that has moved.
    callShirabe.mockResolvedValue(identified([candidate()], 'fp-new'));

    await lookup('兄');

    expect(reportStackFingerprint).toHaveBeenCalledWith(expect.anything(), 'fp-new');
  });

  test('keeps the reader’s own dictionary order', async () => {
    callShirabe.mockResolvedValue(
      identified([
        candidate({ id: 'wikipedia:Q575', dictionary: 'wikipedia' }),
        candidate({ id: 'jmdict:123', dictionary: 'jmdict' }),
      ]),
    );

    const { body } = await lookup('夜');

    expect((body.candidates as { dictionary?: string }[]).map(({ dictionary }) => dictionary)).toEqual([
      'wikipedia',
      'jmdict',
    ]);
  });

  test('and an unchanged one is not reported at all', async () => {
    callShirabe.mockResolvedValue(identified([candidate()], 'abc'));

    await lookup('兄');

    expect(reportStackFingerprint).not.toHaveBeenCalled();
  });
});

describe('a reader with no linked account', () => {
  test('is asked for with no key of their own', async () => {
    await lookup('兄');

    expect(asked().accessToken).toBeUndefined();
  });

  test('gets the PUBLIC answer, which is nearly all the traffic', async () => {
    const { headers } = await lookup('兄');

    expect(headers['cache-control']).toContain('public');
    expect(sharedCache.calls).toBe(1);
  });

  test('is never handed the shared service bearer’s fingerprint', async () => {
    // The client re-keys its cache on this value, and this response is the
    // shared cached one -- so it would end up in everybody's lookup URLs.
    callShirabe.mockResolvedValue(identified([candidate()], 'service-fp'));

    const { body } = await lookup('兄');

    expect(body).not.toHaveProperty('stackFingerprint');
  });

  test('uses Shirabe’s default source stack in the order it returns', async () => {
    sdkPost.mockResolvedValue(
      identified([
        candidate({ id: 'wikipedia:Q575', dictionary: 'wikipedia' }),
        candidate({ id: 'jmdict:123', dictionary: 'jmdict' }),
      ]),
    );

    await lookup('夜');

    expect(asked().body.dictionaries).toBeUndefined();
  });
});

describe('a reader key the other end refuses', () => {
  beforeEach(() => {
    readerStack.mockResolvedValue({ linked: true, fingerprint: 'abc' });
    readerToken.mockResolvedValue('reader-key');
  });

  /** Fails the reader's call with `status`, then answers as the service. */
  function refuse(status: number) {
    callShirabe.mockRejectedValueOnce(httpError(status)).mockResolvedValueOnce(identified([candidate()], 'service-fp'));
  }

  test.each([[401], [403], [429]])('%i still gets an answer, from the default dictionaries', async (status) => {
    // The defaults are a worse answer than theirs and a far better one than
    // none.
    refuse(status);

    const { body } = await lookup('兄');

    expect(body.candidates).toHaveLength(1);
    expect(callShirabe).toHaveBeenCalledTimes(2);
    expect((callShirabe.mock.calls[1]![0] as { accessToken?: string }).accessToken).toBeUndefined();
  });

  test.each([[401], [403]])('%i is reported, so the broken LINK is discoverable', async (status) => {
    refuse(status);

    await lookup('兄');

    expect(reportShirabeRefusal).toHaveBeenCalledWith(expect.anything(), status);
  });

  test('429 is NOT, being about the reader being busy rather than about the key', async () => {
    refuse(429);

    await lookup('兄');

    expect(reportShirabeRefusal).not.toHaveBeenCalled();
  });

  test('the fallback answer is not reported as the reader’s stack', async () => {
    // It came out of OUR dictionaries; reporting it would tell the backend the
    // reader had reconfigured theirs to ours.
    refuse(401);

    const { body } = await lookup('兄');

    expect(reportStackFingerprint).not.toHaveBeenCalled();
    expect(body).not.toHaveProperty('stackFingerprint');
  });

  test('but Shirabe being down is not retried as us', async () => {
    // A 500 says nothing about the reader's key, and a second identical call
    // costs the reader another timeout for the same failure.
    callShirabe.mockRejectedValue(httpError(500));

    await expect(lookup('兄')).rejects.toMatchObject({ statusCode: 503 });
    expect(callShirabe).toHaveBeenCalledTimes(1);
  });
});

describe('a token with no entry', () => {
  test('is a plain 404, not a failure', async () => {
    // Identify answers 200 with no matching span: a word can be parsed out of a
    // subtitle and still have no entry -- a name, a coinage, a typo the corpus
    // preserved.
    callShirabe.mockResolvedValue({ spans: [] });

    await expect(lookup('ドラミちゃん')).rejects.toMatchObject({ statusCode: 404 });
  });

  test('an empty candidate list is the same answer', async () => {
    callShirabe.mockResolvedValue(identified([]));

    await expect(lookup('兄')).rejects.toMatchObject({ statusCode: 404 });
  });

  test('and is never re-read as an upstream failure', async () => {
    // Running our own 404 back through the upstream classification would turn
    // "no entry for this word" into "the dictionary is broken".
    callShirabe.mockResolvedValue({ spans: [] });

    await expect(lookup('ドラミちゃん')).rejects.toMatchObject({ statusCode: 404 });
    expect(logger.error).not.toHaveBeenCalled();
  });
});

describe('names', () => {
  /** A name candidate with the meaning the SDK will display. */
  const person = (id: string, headword: string, gloss = headword) =>
    candidate({
      id,
      headword,
      name: true,
      entries: [{ senses: [{ definitions: [{ lang: 'en', text: gloss }] }] }],
    });

  test('remain ranked after real words', async () => {
    callShirabe.mockResolvedValue(identified([candidate({ id: 'w', headword: '一' }), person('n1', '一', 'Hajime')]));

    const { body } = await lookup('一');

    expect(body.candidates).toHaveLength(2);
    expect((body.candidates as { id: string }[])[0]!.id).toBe('w');
    expect((body.candidates as { id: string }[])[1]!.id).toBe('n1');
  });

  test('retains every name when the result contains only names', async () => {
    callShirabe.mockResolvedValue(identified([person('n1', '明日香', 'Asuka'), person('n2', '飛鳥', 'Asuka (place)')]));

    const { body } = await lookup('明日香');

    expect(body.candidates).toHaveLength(2);
  });

  test('a single name keeps its definition', async () => {
    callShirabe.mockResolvedValue(identified([person('n1', '織田信長', 'Oda Nobunaga (1534-1582)')]));

    const { body } = await lookup('織田信長');

    expect(body.candidates).toHaveLength(1);
  });
});

describe('when the dictionary itself fails', () => {
  test('an HTML 404 is our own bad path, and says so in the log', async () => {
    // The failure that hid for as long as it did: a 404 reads as "this word has
    // no entry", so every card rendered empty and it looked like thin coverage.
    callShirabe.mockRejectedValue(httpError(404, 'text/html'));

    await expect(lookup('兄')).rejects.toMatchObject({ statusCode: 502 });
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ lemma: '兄' }),
      expect.stringContaining('path'),
    );
  });

  test('a JSON 404 from identify is a failure too, not an answer about the word', async () => {
    // A token that resolves to nothing comes back 200, so a 404 here means the
    // route is gone.
    callShirabe.mockRejectedValue(httpError(404, 'application/json'));

    await expect(lookup('兄')).rejects.toMatchObject({ statusCode: 503 });
  });

  test.each([[500], [502], [503]])('a %i is reported as a lookup failure', async (status) => {
    callShirabe.mockRejectedValue(httpError(status));

    const result = lookup('兄');

    await expect(result).rejects.toMatchObject({
      statusCode: 503,
      statusMessage: 'Dictionary temporarily unavailable',
    });
    expect(logger.warn).toHaveBeenCalled();
  });

  test('a timeout is too', async () => {
    callShirabe.mockRejectedValue(new Error('ETIMEDOUT'));

    const result = lookup('兄');

    await expect(result).rejects.toMatchObject({ statusCode: 503 });
  });

  test('a transient failure is retryable and cannot be cached', async () => {
    callShirabe.mockRejectedValue(httpError(503));

    const result = lookup('兄');

    await expect(result).rejects.toMatchObject({ statusCode: 503 });
    expect(lastEvent?.headers).toMatchObject({
      'cache-control': 'no-store',
      'retry-after': '5',
    });
  });
});
