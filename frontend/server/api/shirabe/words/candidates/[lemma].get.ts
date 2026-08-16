import { createError, getQuery, getRouterParam, setResponseHeader } from 'h3';
import { logger } from '~~/server/utils/logger';
import { callShirabe, describeFailure } from '~~/server/utils/shirabeCall';

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

/** One candidate as Shirabe serves it. Narrowed to what the card reads. */
interface ShirabeCandidate {
  id: string;
  headword: string;
  reading?: string | null;
  common?: boolean;
  /** The dictionary's own id, stable across re-imports. Travels with
   *  `dictionary` as the identity behind the derived `id` handle. */
  sourceId?: string;
  dictionary?: string;
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
}

export default defineEventHandler(async (event) => {
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

  try {
    // `locale` rides in the QUERY STRING, not the body. `WordIdentifyRequest` is
    // `additionalProperties: false` with `tokens` as its only property, so a
    // body `locale` is rejected as a 400 before the action runs.
    const answer = await callShirabe<IdentifyResponse>({
      path: '/words/identify',
      method: 'POST',
      query: { locale },
      // Everything the card draws, in one call. Without this a client renders
      // the picked candidate from identify and then has to fetch
      // `GET /api/v1/words/{id}` purely for the pitch diagram, the badges, the
      // dictionary-aligned ruby and the forms row -- two round trips on one tap,
      // and a card that visibly rebuilds itself when the second lands.
      body: { tokens: [token], include: ['pitch', 'frequency', 'furigana', 'jlpt', 'forms', 'notes'] },
      subject: lemma,
    });

    // Identify answers 200 with `words: [null]` for a token that resolves to
    // nothing, so "no entry" now comes from the BODY rather than from a status.
    // A word can be parsed out of a subtitle and still have none -- a name, a
    // coinage, a typo the corpus preserved -- so say so plainly rather than as a
    // failure, and the popup shows the word unlinked.
    const found = answer?.words?.[0];
    if (!found?.candidates?.length) throw createError({ statusCode: 404, statusMessage: 'No entry for this word' });

    // A dictionary entry is the same for everyone and changes when a dictionary
    // is reimported, so it caches hard. This is also what keeps a page of twenty
    // segments from spending twenty round trips on the same word.
    setResponseHeader(event, 'cache-control', `public, max-age=${CACHE_SECONDS}`);
    return found;
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
