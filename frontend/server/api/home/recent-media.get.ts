import { useServerSdk } from '~~/server/utils/sdk';

const TAKE = 10;

// Shared/SWR-cached data deliberately ignores hidden-media preferences. Propagate failures so the page
// can show its retry state rather than silently render an empty grid.
const handler = defineEventHandler(async (event) => {
  return await useServerSdk(event).listMedia({ take: TAKE });
});

// Five minutes suits import-driven updates. One key: the response depends on nothing in the request.
export default defineCachedEventHandler(handler, {
  name: 'home-recent-media',
  swr: true,
  maxAge: 300,
  getKey: () => 'latest',
});
