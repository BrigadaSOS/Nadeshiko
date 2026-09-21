import { createError, defineEventHandler, getQuery, getRouterParam, setResponseHeader } from 'h3';
import { type IdentifyRequest, type IdentifyWordResponse } from '@shirabe-org/api';
import { logger } from '~~/server/utils/logger';
import { callShirabe } from '~~/server/utils/shirabeCall';
import { readerStack, readerToken, reportShirabeRefusal, reportStackFingerprint } from '~~/server/utils/shirabeReader';

/**
 * Which words the selected span could be, ranked, with their definitions.
 *
 * The browser sends the sentence and UTF-16 target span. Shirabe parses that
 * text and supplies ranked matches. This GET can use the day-long HTTP cache;
 * the structured upstream identify request is a POST.
 */

const CACHE_SECONDS = 60 * 60 * 24;
const RETRY_AFTER_SECONDS = 5;

// `locale` resolves part-of-speech and misc labels. Clamped to what Shirabe
// ships a UI in, so arbitrary query strings cannot multiply cached responses.
const LABEL_LOCALES = new Set(['en', 'es']);

const handler = defineEventHandler(async (event) => {
  const lemma = getRouterParam(event, 'lemma');
  if (!lemma) throw createError({ statusCode: 400, statusMessage: 'lemma is required' });

  const query = getQuery(event);
  const requested = String(query.locale ?? '');
  const locale = LABEL_LOCALES.has(requested) ? requested : 'en';

  // A direct request without context identifies its path word as a one-span
  // text. The card normally supplies the full sentence and target offsets.
  const text = typeof query.text === 'string' && query.text ? query.text : lemma;
  const startOffset = query.startOffset === undefined ? 0 : Number(query.startOffset);
  const rawEndOffset = query.endOffset === undefined ? undefined : Number(query.endOffset);
  const validTarget =
    text.length <= 200 &&
    Number.isInteger(startOffset) &&
    startOffset >= 0 &&
    startOffset < text.length &&
    (rawEndOffset === undefined ||
      (Number.isInteger(rawEndOffset) && rawEndOffset > startOffset && rawEndOffset <= text.length));
  if (!validTarget) throw createError({ statusCode: 400, statusMessage: 'Invalid word target' });

  // The reader's own key, when they have linked a Shirabe account. This is the
  // only thing that makes the answer theirs rather than everybody's, and it is
  // fetched HERE rather than beside the cache key because it is only needed on a
  // miss: a cached word costs no backend round trip at all.
  const reader = await readerStack(event);
  const hasOwnStack = reader.linked;
  const readerAccessToken = hasOwnStack ? ((await readerToken(event)) ?? undefined) : undefined;

  const ask = (key?: string): Promise<IdentifyWordResponse> =>
    callShirabe<IdentifyWordResponse>({
      subject: lemma,
      accessToken: key,
      event,
      clientCall: (client) =>
        client.identifyWord(
          {
            text,
            target: { startOffset, ...(rawEndOffset !== undefined ? { endOffset: rawEndOffset } : {}) },
          } satisfies IdentifyRequest,
          { headers: { 'accept-language': locale } },
        ),
    });

  try {
    let answer: IdentifyWordResponse;
    // Whether the answer below is really THEIRS. The fallback path drops to the
    // shared service bearer, and reporting that stack as the reader's would tell the
    // backend their dictionaries had changed to ours.
    let answeredAsReader = Boolean(readerAccessToken);
    try {
      answer = await ask(readerAccessToken);
    } catch (readerError: unknown) {
      // A reader's key can fail in ways ours cannot: revoked at the other end,
      // or over its own per-minute budget, which is much smaller than a service
      // identity's. Neither is a reason to show a broken card -- the default
      // dictionaries are a worse answer than theirs and a far better one than
      // none -- so retry as ourselves before giving up.
      if (!readerAccessToken) throw readerError;

      const status = (readerError as { response?: { status?: number } })?.response?.status;
      if (status !== 401 && status !== 403 && status !== 429) throw readerError;

      logger.warn({ lemma, status }, 'A reader Shirabe key was refused; answering with the default dictionaries');

      // All three still fall back -- the reader gets an answer either way -- but
      // only two of them say anything about the LINK, and that has to reach the
      // backend or the discovery dies here. Shirabe's own distinction: 401 is a
      // key that is invalid, expired or revoked, 403 is one missing a
      // permission, and 429 is the reader being busy, which is not an answer
      // about the key at all.
      //
      // Un-awaited like `reportStackFingerprint`: this request already has what
      // it needs, and what the report buys is the reader's NEXT request not
      // repeating a round trip we now know is doomed.
      if (status !== 429) void reportShirabeRefusal(event, status);

      answeredAsReader = false;
      answer = await ask();
    }

    // Shirabe just said which stack it answered from, and the session says which
    // one we think the reader has. A disagreement means they reconfigured their
    // dictionaries over there since we last looked -- so hand it to the backend,
    // which owns that copy, and do NOT wait for it. This request already holds
    // the fresh answer; what the update buys is the reader's next request being
    // cached under a key that has moved, so every word they already hovered
    // stops being served from a day-old copy.
    if (answeredAsReader && answer?.stackFingerprint && answer.stackFingerprint !== reader.fingerprint) {
      void reportStackFingerprint(event, answer.stackFingerprint);
    }

    // Identify can answer successfully without a match for this span.
    const candidates = answer.spans.find((span) => span.startOffset === startOffset)?.matches ?? [];
    if (!candidates.length) throw createError({ statusCode: 404, statusMessage: 'No entry for this word' });

    // A dictionary entry changes when a dictionary is reimported, so it caches
    // hard. `public` only while the answer is the one everybody gets: a reader
    // asking with their own stack gets a card built from dictionaries that are
    // theirs to have configured, and a shared cache anywhere between here and
    // them would hand it to the next reader through the same hop.
    setResponseHeader(
      event,
      'cache-control',
      hasOwnStack ? `private, max-age=${CACHE_SECONDS}` : `public, max-age=${CACHE_SECONDS}`,
    );
    // The fingerprint goes to the browser ONLY when the answer is really the
    // reader's, and that gate is the whole safety of it. The client re-keys its
    // cache on this value, so handing an unlinked reader the SERVICE key's
    // fingerprint would put it in their lookup URLs -- and this response is the
    // shared, cached one, so it would be the same string for everybody.
    return {
      candidates,
      ...(answeredAsReader && answer?.stackFingerprint ? { stackFingerprint: answer.stackFingerprint } : {}),
    };
  } catch (error: unknown) {
    // Our own 404 above, already shaped. Rethrow rather than running it back
    // through the upstream classification, which would read it as a failure.
    if ((error as { statusCode?: number })?.statusCode === 404) throw error;

    const response = (error as { response?: Response })?.response;
    const status = response?.status;
    if (status === 404 && response?.headers.get('content-type')?.includes('html')) {
      logger.error({ lemma }, 'Shirabe returned an HTML 404 -- the API path is wrong, not the word missing');
      throw createError({ statusCode: 502, statusMessage: 'Dictionary lookup failed' });
    }

    // A JSON 404 from identify itself means the route is gone; an unmatched
    // span comes back 200. Treat it as a
    // failure, not as an answer about the word.
    logger.warn({ lemma, status, err: error }, 'Shirabe identify failed');
    // This route is enrichment for an already-rendered search result. The
    // browser deliberately keeps the token usable and says the dictionary is
    // temporarily unavailable, so describe an unavailable dependency rather
    // than a broken Nadeshiko gateway. `no-store` prevents an intermediary from
    // turning one upstream outage into a day-long blank card, and Retry-After
    // lets callers distinguish a transient answer from a missing word.
    setResponseHeader(event, 'cache-control', 'no-store');
    setResponseHeader(event, 'retry-after', RETRY_AFTER_SECONDS);
    throw createError({ statusCode: 503, statusMessage: 'Dictionary temporarily unavailable' });
  }
});

/**
 * Cached here rather than by a `routeRules` entry, because a rule cannot ask WHO
 * is asking, and the answer is no longer the same for everyone.
 *
 * What is stored is only ever the SHARED answer: the definitions an unlinked
 * reader gets, which is nearly all of the traffic and the whole reason a server
 * cache is worth having. A page of twenty segments holds a few hundred distinct
 * words and 兄 is 兄 for everyone, so the first reader to hover it spares the
 * rest a call that day.
 *
 * A reader with a stack of their own bypasses it entirely. Their answers COULD
 * be shared with readers configured identically -- an earlier version keyed the
 * cache on a fingerprint of the stack to do exactly that -- but it bought very
 * little: sharing only helps where two readers have the same stack, and a stack
 * is the thing people configure differently. It cost an async cache key, a
 * fingerprint plumbed through the session, and a standing risk that a mistake
 * anywhere in it serves one reader's dictionaries to another. One call per word
 * per linked reader per day, which their own browser cache flattens within a
 * session, is the better trade.
 *
 * It also subsumes the case that has to be right rather than merely fast: a
 * stack naming one of the reader's own uploads answers with content nobody else
 * has.
 *
 * `swr` keeps serving the stale copy while it refreshes, so a reader never waits
 * on a revalidation.
 */
const sharedHandler = defineCachedEventHandler(handler, {
  swr: true,
  maxAge: CACHE_SECONDS,
});

export default defineEventHandler(async (event) => {
  const reader = await readerStack(event);
  return reader.linked ? handler(event) : sharedHandler(event);
});
