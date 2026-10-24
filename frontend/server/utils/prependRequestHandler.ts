// Nitro's public-asset handler is the first request layer and terminates /_nuxt misses before middleware/routes
// run, so handlers that answer /_nuxt URLs it has no file for must sit in front of it.

import { logger } from '~~/server/utils/logger';

// Let h3App.use normalize the layer, then prepend it. Unexpected stack shapes return false rather than leave an
// unreachable handler behind Nitro static serving; `label` prefixes the log lines so callers can stay off cleanly.
export function prependRequestHandler(
  nitroApp: { h3App?: { use?: unknown; stack?: unknown } },
  handler: unknown,
  label: string,
): boolean {
  const h3App = nitroApp.h3App;

  if (!h3App || typeof h3App.use !== 'function' || !Array.isArray(h3App.stack)) {
    logger.error(`${label}: cannot reach the request stack, staying off`);
    return false;
  }

  const stack = h3App.stack as unknown[];
  const before = stack.length;

  (h3App.use as (handler: unknown) => unknown)(handler);

  if (stack.length !== before + 1) {
    logger.error(`${label}: the request stack did not take the handler, staying off`);
    return false;
  }

  // Move exactly the newly registered layer, preserving all other order; pop could select an unrelated future layer.
  const [layer] = stack.splice(before, 1);
  if (!layer) {
    logger.error(`${label}: could not identify its request handler, staying off`);
    return false;
  }
  stack.unshift(layer);

  return true;
}
