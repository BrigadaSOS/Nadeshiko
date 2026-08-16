import { createError, getQuery, getRouterParam, setResponseHeader } from 'h3';
import { logger } from '~~/server/utils/logger';
import { callShirabe, describeFailure } from '~~/server/utils/shirabeCall';

/**
 * Everything Shirabe knows about one word, for a word somebody already identified.
 *
 * `GET /api/v1/words/{id}` is untouched by the 0.8.0 resolution changes and is
 * addressed by SLUG -- the word's own spelling plus `-<reading>` and
 * `-<sourceId>` disambiguators only where the spelling alone is ambiguous
 * (`猫`, `私-わたくし`, `開く-ひらく-1202650`). The slug comes off a candidate
 * from `../candidates/[lemma]`; nothing assembles one by hand, because an id is
 * derived from dictionary content and moves when a headword, a commonness flag
 * or a resolution rule moves.
 *
 * It exists as a SECOND call because identify deliberately does not carry
 * everything. A candidate has the headword, reading, commonness and definitions
 * -- enough to render a choice -- but not `furigana`, `jlpt`, `frequency` or
 * `pitch`. Those are what this fills in, and the popup paints without them
 * rather than waiting.
 *
 * Cheaper than it looks: keyed by slug rather than by the token that reached it,
 * so every token in the corpus that resolves to 食べる shares one cache entry,
 * and so does every reader.
 */

const CACHE_SECONDS = 60 * 60 * 24;

const LABEL_LOCALES = new Set(['en', 'es']);

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id');
  if (!id) throw createError({ statusCode: 400, statusMessage: 'id is required' });

  const query = getQuery(event);
  const requested = String(query.locale ?? '');
  const locale = LABEL_LOCALES.has(requested) ? requested : 'en';

  try {
    const word = await callShirabe<unknown>({
      // No `include=examples`, and this is a decision rather than an omission:
      // Nadeshiko's own corpus is the example sentences, and it is the whole
      // point of the site. A dictionary's handful would sit under the card
      // competing with the thing "More sentences" leads to, for 2 to 3x the
      // latency on a common word.
      path: `/words/${encodeURIComponent(id)}`,
      query: { locale },
      subject: id,
    });

    setResponseHeader(event, 'cache-control', `public, max-age=${CACHE_SECONDS}`);
    return word;
  } catch (error: unknown) {
    const { kind, status } = describeFailure(error);

    if (kind === 'bad-path') {
      logger.error({ id }, 'Shirabe returned an HTML 404 -- the API path is wrong, not the word missing');
      throw createError({ statusCode: 502, statusMessage: 'Dictionary lookup failed' });
    }

    // A slug that no longer resolves. Ordinary rather than alarming: ids are
    // derived from dictionary content, so a re-import can retire one that a
    // cached candidate is still carrying. The card keeps what the candidate gave
    // it and simply goes without the detail.
    if (kind === 'missing') throw createError({ statusCode: 404, statusMessage: 'No entry for this id' });

    logger.warn({ id, status, err: error }, 'Shirabe word detail lookup failed');
    throw createError({ statusCode: 502, statusMessage: 'Dictionary lookup failed' });
  }
});
