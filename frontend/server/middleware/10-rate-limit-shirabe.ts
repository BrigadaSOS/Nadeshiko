import { getRequestURL } from 'h3';
import { enforceIpRateLimit, shirabeLookupLimit } from '~~/server/utils/v1ProxyPolicy';

// Word-card lookups are proxied through the frontend's own Shirabe key, so this is their only per-IP ceiling.
// Count cache hits too: the cache key covers every hint, and varying hints is how a flood would miss it.
export default defineEventHandler(async (event) => {
  if (!getRequestURL(event).pathname.toLowerCase().startsWith('/api/shirabe/')) return;
  await enforceIpRateLimit(event, shirabeLookupLimit);
});
