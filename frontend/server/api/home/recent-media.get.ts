import { useServerSdk } from '~~/server/utils/sdk';

/** How many titles the home grid shows. */
const TAKE = 10;

/**
 * The "recently added" grid on the home page.
 *
 * Behind a Nitro route so it can be cached: this list is the same for every
 * visitor -- the home page deliberately does not apply the hidden-media filter,
 * precisely so it stays shareable -- and it changes when media is imported, not
 * when someone loads the page. Fetched straight from the component it was a
 * backend round trip per render with nowhere to hold the answer.
 *
 * The `swr` window lives in `nuxt.config.ts` next to the other caching policy.
 * Errors are deliberately left to propagate: unlike the announcement banner,
 * an empty grid is the page's main content, and the page already renders a retry
 * button for a failed load.
 */
export default defineEventHandler(async (event) => {
  return await useServerSdk(event).listMedia({ take: TAKE });
});
