import { describe, test, expect, beforeEach, vi } from 'vitest';

// Guard homograph hints, private reader caching, and service fallback that never overwrites reader stack identity.
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

vi.mock('~~/server/utils/logger', () => ({ logger }));
vi.mock('~~/server/utils/shirabeCall', async (importOriginal) => ({
  // Keep real failure classification so handler and transport agree on upstream 404s.
  ...(await importOriginal<typeof import('~~/server/utils/shirabeCall')>()),
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
// The cache wrapper is Nitro's; what is under test is the handler it wraps.
vi.stubGlobal('defineCachedEventHandler', (handler: unknown) => handler);

const candidate = (over: Record<string, unknown> = {}) => ({
  id: 'jmdict:1',
  headword: '兄',
  reading: 'あに',
  ...over,
});

const identified = (candidates: unknown[], stackFingerprint?: string) => ({
  words: [{ candidates }],
  ...(stackFingerprint ? { stackFingerprint } : {}),
});

function httpError(status: number, contentType = 'application/json') {
  return {
    response: { status, headers: { get: (key: string) => (key === 'content-type' ? contentType : null) } },
  };
}

let handler: (event: FakeEvent) => Promise<Record<string, unknown>>;
let lastEvent: FakeEvent | undefined;

async function lookup(lemma: string | undefined, query: Record<string, unknown> = {}) {
  handler ??= ((await import('./[lemma].get')) as unknown as { default: typeof handler }).default;
  const event: FakeEvent = { params: lemma === undefined ? {} : { lemma }, query, headers: {} };
  lastEvent = event;
  const body = await handler(event);
  return { body, headers: event.headers };
}

const asked = () =>
  callShirabe.mock.calls[0]![0] as {
    query: Record<string, string>;
    body: { tokens: Record<string, string>[]; include: string[] };
    apiKey?: string;
  };

beforeEach(() => {
  vi.clearAllMocks();
  lastEvent = undefined;
  readerStack.mockResolvedValue({ linked: false, fingerprint: null });
  readerToken.mockResolvedValue(null);
  callShirabe.mockResolvedValue(identified([candidate()]));
});

describe('the question it asks', () => {
  test('refuses a request with no word in it', async () => {
    await expect(lookup(undefined)).rejects.toMatchObject({ statusCode: 400 });
  });

  test('sends the lemma as the token to identify', async () => {
    await lookup('兄');

    expect(asked().body.tokens).toEqual([{ lemma: '兄' }]);
  });

  test('sends the reading, which is the whole reason this route replaced the old one', async () => {
    // Reading distinguishes homographs such as 開いた: ヒライタ must not fall back to あく.
    await lookup('開く', { surface: '開いた', reading: 'ヒライタ', pos: 'verb' });

    expect(asked().body.tokens[0]).toEqual({ lemma: '開く', surface: '開いた', reading: 'ヒライタ', pos: 'verb' });
  });

  test('drops an EMPTY hint rather than sending it', async () => {
    // Blank means an explicit empty hint, not an unknown reading/POS.
    await lookup('兄', { surface: '', reading: '   ', pos: '' });

    expect(asked().body.tokens).toEqual([{ lemma: '兄' }]);
  });

  test('asks for everything the card draws, in ONE call', async () => {
    await lookup('兄');

    expect(asked().body.include).toEqual(
      expect.arrayContaining(['pitch', 'frequency', 'furigana', 'jlpt', 'forms', 'parts']),
    );
  });

  test('asks for the PARTS of an expression, or a merged chip is a dead end', async () => {
    // Expression parts keep merged component words reachable.
    await lookup('男を知っている');

    expect(asked().body.include).toContain('parts');
  });

  test('sends the label locale in the query string, not the body', async () => {
    // Strict identify bodies reject locale; it must be a query parameter.
    await lookup('兄', { locale: 'es' });

    expect(asked().query).toEqual({ locale: 'es', 'dictionaries[]': 'jmdict' });
    expect(asked().body).not.toHaveProperty('locale');
  });

  test.each([['fr'], ['ja'], ['../en'], ['']])('clamps an unshipped locale like %s to English', async (locale) => {
    await lookup('兄', { locale });

    expect(asked().query).toEqual({ locale: 'en', 'dictionaries[]': 'jmdict' });
  });
});

describe('a reader with dictionaries of their own', () => {
  beforeEach(() => {
    readerStack.mockResolvedValue({ linked: true, fingerprint: 'abc' });
    readerToken.mockResolvedValue('reader-key');
  });

  test('is asked for with their key, which is what makes the answer theirs', async () => {
    await lookup('兄');

    expect(asked().apiKey).toBe('reader-key');
    expect(asked().query).toEqual({ locale: 'en' });
  });

  test('gets a PRIVATE cache header, since the card is built from their stack', async () => {
    // A shared cache must never hand one reader another reader's dictionaries.
    const { headers } = await lookup('兄');

    expect(headers['cache-control']).toContain('private');
  });

  test('is told the stack their answer came from, so their client can re-key its cache', async () => {
    callShirabe.mockResolvedValue(identified([candidate()], 'fp-new'));

    const { body } = await lookup('兄');

    expect(body.stackFingerprint).toBe('fp-new');
  });

  test('has a changed stack handed to the backend, without waiting for it', async () => {
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

    expect(asked().apiKey).toBeUndefined();
  });

  test('gets the PUBLIC answer, which is nearly all the traffic', async () => {
    const { headers } = await lookup('兄');

    expect(headers['cache-control']).toContain('public');
  });

  test('is never handed the service key’s fingerprint', async () => {
    callShirabe.mockResolvedValue(identified([candidate()], 'service-fp'));

    const { body } = await lookup('兄');

    expect(body).not.toHaveProperty('stackFingerprint');
  });

  test('asks Shirabe for the lexical default, rather than trying to reorder its mixed result', async () => {
    callShirabe.mockResolvedValue(
      identified([
        candidate({ id: 'wikipedia:Q575', dictionary: 'wikipedia' }),
        candidate({ id: 'jmdict:123', dictionary: 'jmdict' }),
      ]),
    );

    await lookup('夜');

    expect(asked().query).toEqual({ locale: 'en', 'dictionaries[]': 'jmdict' });
  });
});

describe('a reader key the other end refuses', () => {
  beforeEach(() => {
    readerStack.mockResolvedValue({ linked: true, fingerprint: 'abc' });
    readerToken.mockResolvedValue('reader-key');
  });

  function refuse(status: number) {
    callShirabe.mockRejectedValueOnce(httpError(status)).mockResolvedValueOnce(identified([candidate()], 'service-fp'));
  }

  test.each([[401], [403], [429]])('%i still gets an answer, from the default dictionaries', async (status) => {
    refuse(status);

    const { body } = await lookup('兄');

    expect(body.candidates).toHaveLength(1);
    expect(callShirabe).toHaveBeenCalledTimes(2);
    expect((callShirabe.mock.calls[1]![0] as { apiKey?: string }).apiKey).toBeUndefined();
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
    refuse(401);

    const { body } = await lookup('兄');

    expect(reportStackFingerprint).not.toHaveBeenCalled();
    expect(body).not.toHaveProperty('stackFingerprint');
  });

  test('but Shirabe being down is not retried as us', async () => {
    callShirabe.mockRejectedValue(httpError(500));

    await expect(lookup('兄')).rejects.toMatchObject({ statusCode: 503 });
    expect(callShirabe).toHaveBeenCalledTimes(1);
  });
});

describe('a token with no entry', () => {
  test('is a plain 404, not a failure', async () => {
    callShirabe.mockResolvedValue({ words: [null] });

    await expect(lookup('ドラミちゃん')).rejects.toMatchObject({ statusCode: 404 });
  });

  test('an empty candidate list is the same answer', async () => {
    callShirabe.mockResolvedValue(identified([]));

    await expect(lookup('兄')).rejects.toMatchObject({ statusCode: 404 });
  });

  test('and is never re-read as an upstream failure', async () => {
    callShirabe.mockResolvedValue({ words: [null] });

    await expect(lookup('ドラミちゃん')).rejects.toMatchObject({ statusCode: 404 });
    expect(logger.error).not.toHaveBeenCalled();
  });
});

describe('names', () => {
  // Include readable glosses: missing glosses count as unknown answers and would bypass the single-name branch.
  const person = (id: string, headword: string, gloss = headword) =>
    candidate({
      id,
      headword,
      name: true,
      entries: [{ senses: [{ definitions: [{ lang: 'en', text: gloss }] }] }],
    });

  test('are dropped while there is a real word to show', async () => {
    callShirabe.mockResolvedValue(identified([candidate({ id: 'w', headword: '一' }), person('n1', '一', 'Hajime')]));

    const { body } = await lookup('一');

    expect(body.candidates).toHaveLength(1);
    expect((body.candidates as { id: string }[])[0]!.id).toBe('w');
  });

  test('ARE the answer when there is no word to compete with', async () => {
    callShirabe.mockResolvedValue(identified([person('n1', '明日香', 'Asuka'), person('n2', '飛鳥', 'Asuka (place)')]));

    const { body } = await lookup('明日香');

    expect(body.candidates).toHaveLength(2);
  });

  test('and many of them are answered with the one-liner instead of a picker', async () => {
    callShirabe.mockResolvedValue(identified([person('n1', '明日香', 'Asuka'), person('n2', '飛鳥', 'Asuka (place)')]));

    const { body } = await lookup('明日香');

    expect(body.nameOnly).toBe(true);
  });

  test('and several saying the SAME thing are not many answers', async () => {
    const gloss = 'Doraemon (manga by Fujiko F. Fujio; media franchise)';
    callShirabe.mockResolvedValue(identified([person('n1', 'ドラえもん', gloss), person('n2', 'ドラエモン', gloss)]));

    const { body } = await lookup('ドラえもん');

    expect(body.nameOnly).toBe(false);
  });

  test('but a single name keeps its definition, which is often the whole point', async () => {
    callShirabe.mockResolvedValue(identified([person('n1', '織田信長', 'Oda Nobunaga (1534-1582)')]));

    const { body } = await lookup('織田信長');

    expect(body.nameOnly).toBe(false);
    expect(body.candidates).toHaveLength(1);
  });

  test('a real word is never flagged as a name', async () => {
    const { body } = await lookup('兄');

    expect(body.nameOnly).toBe(false);
  });
});

describe('when the dictionary itself fails', () => {
  test('an HTML 404 is our own bad path, and says so in the log', async () => {
    callShirabe.mockRejectedValue(httpError(404, 'text/html'));

    await expect(lookup('兄')).rejects.toMatchObject({ statusCode: 502 });
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ lemma: '兄' }),
      expect.stringContaining('path'),
    );
  });

  test('a JSON 404 from identify is a failure too, not an answer about the word', async () => {
    // Identify returns missing tokens in a 200 body; an upstream 404 is a route failure.
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
