import { createError, getQuery, getRouterParam, setResponseHeader } from 'h3';
import { logger } from '~~/server/utils/logger';

/**
 * Definitions for one word, from Shirabe.
 *
 * The `wid` comes off a token: Shirabe parsed the corpus and stamped each word
 * with the id its own entry lives at, so there is no slug to reconstruct and no
 * homograph to guess at. A token with no `wid` has no entry, and the caller
 * should not reach this route at all.
 *
 * It is a server route and not a browser fetch because of the key. Shirabe
 * authenticates with a service key that is ours, not the visitor's, and a key
 * that reaches the browser is a key that has been given away. Same reasoning as
 * `nadeshikoApiKey` in server/utils/backendProxy.ts.
 */

const CACHE_SECONDS = 60 * 60 * 24;

// `locale` resolves the part-of-speech and misc labels into ONE language, and it
// is the only thing about this response that varies by reader: the definitions
// come back in every language the entry has and the caller picks. Clamped to
// what Shirabe ships a UI in, so an arbitrary query string cannot multiply the
// cached copies of a word that is the same for everyone.
const LABEL_LOCALES = new Set(['en', 'es']);

export default defineEventHandler(async (event) => {
  const wid = getRouterParam(event, 'wid');
  if (!wid) throw createError({ statusCode: 400, statusMessage: 'wid is required' });

  const requested = String(getQuery(event).locale ?? '');
  const locale = LABEL_LOCALES.has(requested) ? requested : 'en';

  const config = useRuntimeConfig();
  const base = String(config.shirabeApiBase || 'https://shirabe.org').replace(/\/$/, '');
  const apiKey = String(config.shirabeApiKey || '').trim();
  if (!apiKey) throw createError({ statusCode: 503, statusMessage: 'Shirabe lookups are not configured' });

  try {
    const word = await $fetch(`${base}/v1/words/${encodeURIComponent(wid)}`, {
      headers: { authorization: `Bearer ${apiKey}` },
      // Examples are off for now (owner, 2026-08-06). Asking for them is what
      // makes them exist: `include=examples` is opt-in, it costs 2 to 3x the
      // latency on a common word, and with it absent `cardExamples` finds
      // nothing and the block does not render. Put 'examples' back to restore.
      query: { locale },
      timeout: 5000,
    });

    // A dictionary entry is the same for everyone and changes when a dictionary
    // is reimported, so it caches hard. This is also what keeps a page of
    // twenty segments from spending twenty round trips on the same word.
    setResponseHeader(event, 'cache-control', `public, max-age=${CACHE_SECONDS}`);
    return word;
  } catch (error: unknown) {
    const status = (error as { response?: { status?: number } })?.response?.status;

    // 404 is an ordinary answer here: a word can be parsed out of a subtitle and
    // still have no entry (a name, a coinage, a typo the corpus preserved). Say
    // so plainly rather than as a failure, so the popup shows the word unlinked.
    if (status === 404) throw createError({ statusCode: 404, statusMessage: 'No entry for this word' });

    logger.warn({ wid, status, err: error }, 'Shirabe word lookup failed');
    throw createError({ statusCode: 502, statusMessage: 'Dictionary lookup failed' });
  }
});
