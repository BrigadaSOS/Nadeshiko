import { createError, getQuery, getRouterParam, setResponseHeader } from 'h3';
import { logger } from '~~/server/utils/logger';
import { callShirabe, describeFailure } from '~~/server/utils/shirabeCall';
import {
  readerHasOwnStack,
  readerStack,
  readerToken,
  reportShirabeRefusal,
  reportStackFingerprint,
} from '~~/server/utils/shirabeReader';
import { distinctNameAnswers, withoutNameEntries } from '~~/server/utils/shirabeNames';

/**
 * Which words a token could be, ranked, with their definitions.
 *
 * `POST /api/v1/words/identify` is the question this asks: tokens in, ranked
 * candidates out, and nothing stored anywhere. It replaces a lookup by lemma
 * that used to narrow itself with `?surface=&reading=&pos=` -- a mode Shirabe
 * removed in 0.8.0, because one path segment meaning either a slug or a lemma
 * depending on the query string is how two resources drift apart.
 *
 * That removal is why this exists rather than being a tidy-up. `GET
 * /api/v1/words/{id}` still answers a bare lemma, and a lemma is almost always
 * its own headword, so the old call kept working for nearly every word -- while
 * SILENTLY ignoring the reading. A homograph then fell to Shirabe's
 * commonest-writing tiebreak instead of to how the sentence actually read it:
 * 開いた reads ヒライタ and means ひらく, and the card would confidently print
 * あく. Nothing alerted, because a wrong definition is not an error.
 *
 * A LIST rather than one word, because one answer is a claim that often cannot
 * be supported: きみ can be 君, 黄身 or 黍, and only the reader knows which they
 * meant. `candidates[0]` is Shirabe's best reading of the sentence; the popup
 * offers the rest.
 *
 * Still a GET, and that is deliberate. The upstream call is a POST because its
 * inputs are structured, but a POST from the BROWSER would make the
 * `cache-control` below inert -- and that day-long cache is what keeps a page of
 * twenty segments from spending twenty round trips on the same word.
 */

const CACHE_SECONDS = 60 * 60 * 24;

// `locale` resolves the part-of-speech and misc labels into ONE language, and it
// is the only thing about this response that varies by reader: the definitions
// come back in every language the entry has and the caller picks. Clamped to
// what Shirabe ships a UI in, so an arbitrary query string cannot multiply the
// cached copies of a word that is the same for everyone.
const LABEL_LOCALES = new Set(['en', 'es']);

/* Names are dropped before the answer leaves this route -- see
 * `withoutNameEntries` for why, and why an all-names result reads as no entry.
 * Here rather than in the card so the cached response carries no candidate
 * anybody will render, and one place decides. */

/** One candidate as Shirabe serves it. Narrowed to what the card reads. */
interface ShirabeCandidate {
  id: string;
  headword: string;
  /** What to call this candidate when its headword is a kana form the reader
   *  never typed (あなた finding 彼方, which is called かなた). A label; the card
   *  keeps using `id` and `headword` for everything else. */
  matchedHeadword?: string | null;
  reading?: string | null;
  common?: boolean;
  /** The dictionary's own id, stable across re-imports. Travels with
   *  `dictionary` as the identity behind the derived `id` handle. */
  sourceId?: string;
  dictionary?: string;
  /** Shirabe's own answer to "is this a person rather than a word", which a
   *  client cannot derive: see `withoutNameEntries`. */
  name?: boolean;
  /** The words a multi-word expression is made of, each with an id that opens
   *  it. Absent for an ordinary word and for grammar. */
  parts?: unknown[];
  entries?: unknown[];
  // Only with the `include` below, and the reason the card needs no second call.
  pitch?: unknown[];
  furigana?: unknown[];
  forms?: unknown[];
  frequency?: number | null;
  jlpt?: string | null;
}

interface IdentifyResponse {
  /** Index-aligned with the tokens sent. `null` wherever nothing resolves, which
   *  is ordinary for names, numbers, coined words and most symbols. */
  words: Array<{ candidates: ShirabeCandidate[] } | null>;
  /** Which dictionary stack the calling key's answers came out of. The same
   *  digest `/api/v1/me` reports, echoed here so a client notices its cached
   *  answers have gone stale without polling for it. */
  stackFingerprint?: string | null;
}

const handler = defineEventHandler(async (event) => {
  const lemma = getRouterParam(event, 'lemma');
  if (!lemma) throw createError({ statusCode: 400, statusMessage: 'lemma is required' });

  const query = getQuery(event);
  const requested = String(query.locale ?? '');
  const locale = LABEL_LOCALES.has(requested) ? requested : 'en';

  // Optional, and each one only narrows: Shirabe ranks a bare lemma without
  // them, which is what a token carrying no reading or POS needs. Empty strings
  // are dropped rather than sent, so a blank never reads as "no reading".
  //
  // `pos` must be Shirabe's SHORT tag (`verb`, `prt`, `pron`), not a UniDic one.
  // The caller owes that; see `shortPos` in ~/utils/tokenEnrichment. Sent raw it
  // is not an error, it just skips the rung of the ranking that a closed word
  // class decides -- which is the rung きみ needs to answer 君 over the grain 黍.
  const token: Record<string, string> = { lemma };
  for (const key of ['surface', 'reading', 'pos'] as const) {
    const value = String(query[key] ?? '').trim();
    if (value) token[key] = value;
  }

  // The reader's own key, when they have linked a Shirabe account. This is the
  // only thing that makes the answer theirs rather than everybody's, and it is
  // fetched HERE rather than beside the cache key because it is only needed on a
  // miss: a cached word costs no backend round trip at all.
  const reader = await readerStack(event);
  const hasOwnStack = reader.linked;
  const apiKey = hasOwnStack ? ((await readerToken(event)) ?? undefined) : undefined;

  const ask = (key?: string) =>
    // `locale` rides in the QUERY STRING, not the body. `WordIdentifyRequest` is
    // `additionalProperties: false` with `tokens` as its only property, so a
    // body `locale` is rejected as a 400 before the action runs.
    callShirabe<IdentifyResponse>({
      path: '/words/identify',
      method: 'POST',
      query: { locale },
      // Everything the card draws, in one call. Without this a client renders
      // the picked candidate from identify and then has to fetch
      // `GET /api/v1/words/{id}` purely for the pitch diagram, the badges, the
      // dictionary-aligned ruby and the forms row -- two round trips on one tap,
      // and a card that visibly rebuilds itself when the second lands.
      // `parts` is what a merged expression is made of. Without it 男を知っている
      // is a dead end: the chip spans 男 and 知る, the expression is the only
      // candidate, and neither word can be reached at all.
      body: {
        tokens: [token],
        include: ['pitch', 'frequency', 'furigana', 'jlpt', 'forms', 'notes', 'parts'],
      },
      subject: lemma,
      apiKey: key,
    });

  try {
    let answer: IdentifyResponse;
    // Whether the answer below is really THEIRS. The fallback path drops to the
    // service key, and reporting that stack as the reader's would tell the
    // backend their dictionaries had changed to ours.
    let answeredAsReader = Boolean(apiKey);
    try {
      answer = await ask(apiKey);
    } catch (readerError: unknown) {
      // A reader's key can fail in ways ours cannot: revoked at the other end,
      // or over its own per-minute budget, which is much smaller than a service
      // identity's. Neither is a reason to show a broken card -- the default
      // dictionaries are a worse answer than theirs and a far better one than
      // none -- so retry as ourselves before giving up.
      if (!apiKey) throw readerError;

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

    // Identify answers 200 with `words: [null]` for a token that resolves to
    // nothing, so "no entry" now comes from the BODY rather than from a status.
    // A word can be parsed out of a subtitle and still have none -- a name, a
    // coinage, a typo the corpus preserved -- so say so plainly rather than as a
    // failure, and the popup shows the word unlinked.
    const found = answer?.words?.[0];
    // Names are dropped while there is a real word to show, and ARE the answer
    // when there is not.
    //
    // The two cases are different questions. ここ is a reading ten people happen
    // to share, so their entries compete with the pronoun the reader actually
    // met -- six rows all glossing "Koko", none of them what was asked. 明日香 is
    // nobody's reading but its own: there is no word to compete with, and
    // answering "no dictionary entry" would be false as well as useless. The
    // reader's real question at a name is "is this vocabulary or a person?", and
    // the useful answer is the second one.
    //
    // 一 is the case that shows why this is a rule and not a preference: it is
    // both Hajime and "one". A word exists, so the names go, and a learner
    // reading a subtitle gets "one".
    const all = found?.candidates ?? [];
    const words = withoutNameEntries(all);
    const candidates = words.length > 0 ? words : all;
    if (!candidates.length) throw createError({ statusCode: 404, statusMessage: 'No entry for this word' });

    // ...but only when being a name is genuinely all there is to say.
    //
    // The paragraph above is right about 明日香 and wrong about ドラえもん, and the
    // difference is not names, it is repetition. 明日香 is four people and four
    // glosses, so one line beats a picker of strangers. ドラえもん is two
    // candidates saying the same sentence -- "Doraemon (manga by Fujiko F. Fujio;
    // media franchise)" -- and 織田信長 is one. Answering those with "this looks
    // like a name" throws away the definition the reader came for, in a corpus
    // made of anime subtitles where that definition is often the whole point.
    //
    // So the one-liner is kept for the many-answers case and dropped for the
    // single-answer one, where the card renders the entry as it would any other.
    // The candidates still carry `name: true`, so the card keeps tagging them --
    // the reader is told it is a name AND what it is, rather than one instead of
    // the other.
    const nameOnly = words.length === 0 && distinctNameAnswers(all) > 1;

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
    // Said by the route rather than re-derived downstream: the fallback for a
    // Shirabe that does not send `name` is a slug test the client has no business
    // repeating, and this is the one place that already knows the answer.
    //
    // The fingerprint goes to the browser ONLY when the answer is really the
    // reader's, and that gate is the whole safety of it. The client re-keys its
    // cache on this value, so handing an unlinked reader the SERVICE key's
    // fingerprint would put it in their lookup URLs -- and this response is the
    // shared, cached one, so it would be the same string for everybody.
    return {
      ...found,
      candidates,
      nameOnly,
      ...(answeredAsReader && answer?.stackFingerprint ? { stackFingerprint: answer.stackFingerprint } : {}),
    };
  } catch (error: unknown) {
    // Our own 404 above, already shaped. Rethrow rather than running it back
    // through the upstream classification, which would read it as a failure.
    if ((error as { statusCode?: number })?.statusCode === 404) throw error;

    const { kind, status } = describeFailure(error);

    if (kind === 'bad-path') {
      logger.error({ lemma }, 'Shirabe returned an HTML 404 -- the API path is wrong, not the word missing');
      throw createError({ statusCode: 502, statusMessage: 'Dictionary lookup failed' });
    }

    // A JSON 404 from identify itself would be Shirabe saying the ROUTE is gone,
    // since a token that resolves to nothing comes back 200. Treat it as a
    // failure, not as an answer about the word.
    logger.warn({ lemma, status, err: error }, 'Shirabe identify failed');
    throw createError({ statusCode: 502, statusMessage: 'Dictionary lookup failed' });
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
export default defineCachedEventHandler(handler, {
  swr: true,
  maxAge: CACHE_SECONDS,
  shouldBypassCache: readerHasOwnStack,
});
