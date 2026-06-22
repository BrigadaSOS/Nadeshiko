import { enforceIpRateLimit, v1ApiLimit } from '~~/server/utils/v1ProxyPolicy';
import { proxyToBackend } from '~~/server/utils/backendProxy';

export default defineEventHandler(async (event) => {
  await enforceIpRateLimit(event, v1ApiLimit);
  return await proxyToBackend(event);
});
