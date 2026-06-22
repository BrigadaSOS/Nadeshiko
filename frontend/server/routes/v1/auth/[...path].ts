import { enforceIpRateLimit, v1AuthLimit } from '~~/server/utils/v1ProxyPolicy';
import { proxyToBackend } from '~~/server/utils/backendProxy';

export default defineEventHandler(async (event) => {
  await enforceIpRateLimit(event, v1AuthLimit);
  return await proxyToBackend(event);
});
