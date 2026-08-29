import { describe, test, expect, beforeEach, vi } from 'vitest';

/**
 * "Which words could this token be?", with the definitions attached.
 *
 * It asks `POST /words/identify` rather than the old lookup-by-lemma, and that
 * is the whole reason it exists. `GET /words/{id}` answers a bare lemma, and a
 * lemma is almost always its own headword -- so the old call kept working for
 * nearly every word while SILENTLY ignoring the reading. A homograph then fell
 * to Shirabe's commonest-writing tiebreak instead of to how the sentence read
 * it: 開いた reads ヒライタ and means ひらく, and the card confidently printed
 * あく. Nothing alerted, because a wrong definition is not an error.
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

vi.mock('~~/server/utils/logger', () => ({ logger }));
vi.mock('~~/server/utils/shirabeCall', async (importOriginal) => ({
  // The real `describeFailure`: it is the shared half of the decision this
  // route makes about a 404, and a double would let the two drift apart.
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
    setResponseHeader: (event: FakeEvent, name: string, value: string) => {
      event.headers[name] = value;
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

/** An identify answer with these candidates for the single token asked about. */
const identified = (candidates: unknown[], stackFingerprint?: string) => ({
  words: [{ candidates }],
  ...(stackFingerprint ? { stackFingerprint } : {}),
});

/** An error shaped the way `$fetch` throws for an HTTP status. */
function httpError(status: number, contentType = 'application/json') {
  return {
    response: { status, headers: { get: (key: string) => (key === 'content-type' ? contentType : null) } },
  };
}

let handler: (event: FakeEvent) => Promise<Record<string, unknown>>;

/** Asks for one lemma, returning the response body and the headers set on it. */
async function lookup(lemma: string | undefined, query: Record<string, unknown> = {}) {
  handler ??= ((await import('./[lemma].get')) as unknown as { default: typeof handler }).default;
  const event: FakeEvent = { params: lemma === undefined ? {} : { lemma }, query, headers: {} };
  const body = await handler(event);
  return { body, headers: event.headers };
}

/** The body of the identify request that was sent upstream. */
const asked = () =>
  callShirabe.mock.calls[0]![0] as {
    query: Record<string, string>;
    body: { tokens: Record<string, string>[]; include: string[] };
    apiKey?: string;
  };

beforeEach(() => {
  vi.clearAllMocks();
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
    // Without it 開いた falls to the commonest-writing tiebreak and the card
    // prints あく for a sentence that reads ヒライタ.
    await lookup('開く', { surface: '開いた', reading: 'ヒライタ', pos: 'verb' });

    expect(asked().body.tokens[0]).toEqual({ lemma: '開く', surface: '開いた', reading: 'ヒライタ', pos: 'verb' });
  });

  test('drops an EMPTY hint rather than sending it', async () => {
    // A blank would read as "no reading", which is a different claim from "I do
    // not know the reading" -- and an unrecognised `pos` makes the lookup answer
    // with no candidates at all.
    await lookup('兄', { surface: '', reading: '   ', pos: '' });

    expect(asked().body.tokens).toEqual([{ lemma: '兄' }]);
  });

  test('asks for everything the card draws, in ONE call', async () => {
    // Otherwise the card renders and then visibly rebuilds itself when a second
    // request lands purely for the pitch diagram and the badges.
    await lookup('兄');

    expect(asked().body.include).toEqual(
      expect.arrayContaining(['pitch', 'frequency', 'furigana', 'jlpt', 'forms', 'parts']),
    );
  });

  test('asks for the PARTS of an expression, or a merged chip is a dead end', async () => {
    // 男を知っている spans 男 and 知る, the expression is the only candidate, and
    // without `parts` neither word can be reached at all.
    await lookup('男を知っている');

    expect(asked().body.include).toContain('parts');
  });

  test('sends the label locale in the query string, not the body', async () => {
    // `WordIdentifyRequest` is `additionalProperties: false`, so a body
    // `locale` is a 400 before the action runs.
    await lookup('兄', { locale: 'es' });

    expect(asked().query).toEqual({ locale: 'es' });
    expect(asked().body).not.toHaveProperty('locale');
  });

  test.each([['fr'], ['ja'], ['../en'], ['']])('clamps an unshipped locale like %s to English', async (locale) => {
    // An arbitrary query string would otherwise multiply the cached copies of a
    // word that is the same for everyone.
    await lookup('兄', { locale });

    expect(asked().query).toEqual({ locale: 'en' });
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
  });

  test('gets a PRIVATE cache header, since the card is built from their stack', async () => {
    // A shared cache between here and them would hand their dictionaries to the
    // next reader through the same hop.
    const { headers } = await lookup('兄');

    expect(headers['cache-control']).toContain('private');
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
    // The client re-keys its cache on this value, and this response is the
    // shared cached one -- so it would end up in everybody's lookup URLs.
    callShirabe.mockResolvedValue(identified([candidate()], 'service-fp'));

    const { body } = await lookup('兄');

    expect(body).not.toHaveProperty('stackFingerprint');
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

    await expect(lookup('兄')).rejects.toMatchObject({ statusCode: 502 });
    expect(callShirabe).toHaveBeenCalledTimes(1);
  });
});

describe('a token with no entry', () => {
  test('is a plain 404, not a failure', async () => {
    // Identify answers 200 with `words: [null]`: a word can be parsed out of a
    // subtitle and still have no entry -- a name, a coinage, a typo the corpus
    // preserved.
    callShirabe.mockResolvedValue({ words: [null] });

    await expect(lookup('ドラミちゃん')).rejects.toMatchObject({ statusCode: 404 });
  });

  test('an empty candidate list is the same answer', async () => {
    callShirabe.mockResolvedValue(identified([]));

    await expect(lookup('兄')).rejects.toMatchObject({ statusCode: 404 });
  });

  test('and is never re-read as an upstream failure', async () => {
    // Running our own 404 back through the upstream classification would turn
    // "no entry for this word" into "the dictionary is broken".
    callShirabe.mockResolvedValue({ words: [null] });

    await expect(lookup('ドラミちゃん')).rejects.toMatchObject({ statusCode: 404 });
    expect(logger.error).not.toHaveBeenCalled();
  });
});

describe('names', () => {
  /**
   * A name candidate WITH its gloss.
   *
   * The gloss is not decoration here: a candidate carrying nothing readable
   * counts as an unknown answer rather than a repeated one, so a fixture
   * without one makes every name list look like many distinct people and the
   * single-name branch below is never reached.
   */
  const person = (id: string, headword: string, gloss = headword) =>
    candidate({
      id,
      headword,
      name: true,
      entries: [{ senses: [{ definitions: [{ lang: 'en', text: gloss }] }] }],
    });

  test('are dropped while there is a real word to show', async () => {
    // 一 is both Hajime and "one". A word exists, so the names go, and a learner
    // reading a subtitle gets "one".
    callShirabe.mockResolvedValue(identified([candidate({ id: 'w', headword: '一' }), person('n1', '一', 'Hajime')]));

    const { body } = await lookup('一');

    expect(body.candidates).toHaveLength(1);
    expect((body.candidates as { id: string }[])[0]!.id).toBe('w');
  });

  test('ARE the answer when there is no word to compete with', async () => {
    // 明日香 is nobody's reading but its own, and "no dictionary entry" would be
    // false as well as useless.
    callShirabe.mockResolvedValue(identified([person('n1', '明日香', 'Asuka'), person('n2', '飛鳥', 'Asuka (place)')]));

    const { body } = await lookup('明日香');

    expect(body.candidates).toHaveLength(2);
  });

  test('and many of them are answered with the one-liner instead of a picker', async () => {
    // Four people and four glosses beats a picker of strangers.
    callShirabe.mockResolvedValue(identified([person('n1', '明日香', 'Asuka'), person('n2', '飛鳥', 'Asuka (place)')]));

    const { body } = await lookup('明日香');

    expect(body.nameOnly).toBe(true);
  });

  test('and several saying the SAME thing are not many answers', async () => {
    // ドラえもん is two candidates with one sentence between them --
    // "Doraemon (manga by Fujiko F. Fujio; media franchise)" -- and answering
    // that with "this looks like a name" throws away what the reader came for.
    const gloss = 'Doraemon (manga by Fujiko F. Fujio; media franchise)';
    callShirabe.mockResolvedValue(identified([person('n1', 'ドラえもん', gloss), person('n2', 'ドラエモン', gloss)]));

    const { body } = await lookup('ドラえもん');

    expect(body.nameOnly).toBe(false);
  });

  test('but a single name keeps its definition, which is often the whole point', async () => {
    // ドラえもん is two candidates saying the same sentence and 織田信長 is one.
    // Answering those with "this looks like a name" throws away the definition
    // the reader came for, in a corpus made of anime subtitles.
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

    await expect(lookup('兄')).rejects.toMatchObject({ statusCode: 502 });
  });

  test.each([[500], [502], [503]])('a %i is reported as a lookup failure', async (status) => {
    callShirabe.mockRejectedValue(httpError(status));

    await expect(lookup('兄')).rejects.toMatchObject({ statusCode: 502 });
    expect(logger.warn).toHaveBeenCalled();
  });

  test('a timeout is too', async () => {
    callShirabe.mockRejectedValue(new Error('ETIMEDOUT'));

    await expect(lookup('兄')).rejects.toMatchObject({ statusCode: 502 });
  });
});
