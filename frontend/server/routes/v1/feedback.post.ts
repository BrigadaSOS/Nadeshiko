import { enforceIpRateLimit, v1FeedbackLimit } from '~~/server/utils/v1ProxyPolicy';
import { proxyToBackend } from '~~/server/utils/backendProxy';

// Give unauthenticated email submissions their own stricter bucket. Nitro picks this exact POST route;
// feedback-token reads still use the general catch-all.
export default defineEventHandler(async (event) => {
  await enforceIpRateLimit(event, v1FeedbackLimit);
  return await proxyToBackend(event);
});
