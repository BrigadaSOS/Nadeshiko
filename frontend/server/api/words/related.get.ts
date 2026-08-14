import { SEARCH_QUERY_MAX_LENGTH } from '~/utils/routes';
import { relatedWords } from '~~/server/utils/relatedWordsIndex';

/**
 * Words worth linking to from a word page. Same for every reader, so it is
 * `swr`-cached in `nuxt.config.ts`.
 */
export default defineEventHandler(async (event) => {
  const word = getQuery(event).word;

  if (typeof word !== 'string' || !word) {
    throw createError({ statusCode: 400, statusMessage: 'Missing word' });
  }

  // The same bound the search route enforces on a path segment. Without it this
  // handler would happily scan the index for an arbitrarily long string handed
  // to it by anyone.
  if (word.length > SEARCH_QUERY_MAX_LENGTH) {
    throw createError({ statusCode: 400, statusMessage: 'Word too long' });
  }

  return { words: await relatedWords(word, 12, event) };
});
