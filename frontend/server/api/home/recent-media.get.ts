import { useServerSdk } from '~~/server/utils/sdk';

const TAKE = 10;

// Shared/SWR-cached data deliberately ignores hidden-media preferences. Propagate failures so the page
// can show its retry state rather than silently render an empty grid.
export default defineEventHandler(async (event) => {
  return await useServerSdk(event).listMedia({ take: TAKE });
});
