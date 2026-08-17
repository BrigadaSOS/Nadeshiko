import { enforceIpRateLimit, v1FeedbackLimit } from '~~/server/utils/v1ProxyPolicy';
import { proxyToBackend } from '~~/server/utils/backendProxy';

/**
 * The feedback submission, split out of the `/v1/**` catch-all for one reason:
 * its own rate-limit bucket.
 *
 * Everything else the proxy forwards is either authenticated or a read. This is
 * neither — it is the site's only unauthenticated write, and it queues an email
 * — so leaving it to share the general `v1.api` budget of 120/min would mean a
 * single visitor could put 120 messages in the inbox before anything noticed.
 *
 * Nitro matches the more specific route first, so this handles exactly
 * `POST /v1/feedback`; `GET /v1/feedback/token` still falls through to the
 * catch-all, which is right — issuing a token is a cheap read and the limit that
 * matters is on the submission it enables.
 */
export default defineEventHandler(async (event) => {
  await enforceIpRateLimit(event, v1FeedbackLimit);
  return await proxyToBackend(event);
});
