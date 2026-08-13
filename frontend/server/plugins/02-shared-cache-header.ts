/**
 * Emits `CDN-Cache-Control` on the shared tier, once the status code exists.
 *
 * The decision has three parts and they are not all knowable at the same moment.
 * `98-html-response-headers` answers the first two from the request — is this
 * visitor anonymous, is this path public — and records the answer on the event.
 * The third can only be answered after the render: **did this actually produce a
 * page?**
 *
 * Getting that wrong is worse than not caching at all. Written in the middleware,
 * the header rode out on every response the render produced, a 500 included: a
 * backend blip during one anonymous request would have handed Cloudflare a server
 * error to serve to every visitor for the next five minutes, long after the
 * backend recovered. Errors are exactly the responses a shared cache must not
 * hold, and exactly the ones an upstream middleware cannot recognise.
 *
 * 200 only, deliberately — not "not a 5xx". A 404 is cheap to re-render and
 * caching it means a page that starts existing stays missing for the TTL; a 302
 * on a public path would be a per-visitor decision by definition. If a redirect
 * ever needs edge caching it should say so itself.
 */

// How long a CDN may hold a shared copy, chosen per path. The reasoning, and
// why it is not one constant, lives with the function in
// `server/utils/sharedCdnTtl.ts` -- kept out of here so it can be tested
// without Nitro's auto-imports.
import { sharedCdnMaxAge } from '~~/server/utils/sharedCdnTtl';

export default defineNitroPlugin((nitroApp) => {
  // `render:response`, not `beforeResponse`. The latter is h3's, and a rendered
  // page never reaches it -- the Nuxt renderer applies its own headers and sends,
  // so a header written there is silently dropped. This one fires inside the
  // render pipeline, immediately before those headers are applied to the event,
  // which is the first moment the status code exists and the last at which the
  // headers can still be changed.
  nitroApp.hooks.hook('render:response', (response, { event }) => {
    if (!event.context.ndShareable) return;
    if (response.statusCode !== undefined && response.statusCode !== 200) return;

    response.headers = {
      ...response.headers,
      'CDN-Cache-Control': `public, max-age=${sharedCdnMaxAge(getRequestURL(event).pathname)}`,
    };
  });
});
