import { getRequestHeader, getResponseStatus, removeResponseHeader, setResponseHeader, setResponseStatus } from 'h3';
import { htmlEtag, ifNoneMatchSatisfied } from '~~/server/utils/htmlEtag';

/**
 * Turns the revalidation a signed-in reader was already doing into a 304.
 *
 * `98-html-response-headers` sends `Cache-Control: private, no-cache` on every
 * page, which asks the browser to store the document and check with the origin
 * before reusing it. That check has been running on every navigation and coming
 * back with the whole document, because the response carried no validator to
 * check against. This adds one. The digest and the reasoning behind eliding the
 * CSP nonce live in `server/utils/htmlEtag.ts`.
 *
 * `beforeResponse`, NOT `render:response`, and the difference matters twice.
 * `render:response` fires while the render pipeline still has work to do:
 * nuxt-security's own `render:response` hooks (`50-updateCsp`, then
 * `70-securityHeaders`) run there and write the CSP header, so a hook that
 * removed it would be racing plugin registration order. `beforeResponse` is h3's
 * app-level hook, called once the handler has returned and every header is on
 * the event -- the first moment the complete response exists and the last at
 * which it can still be changed. It also hands over `response.body`, which is
 * what has to be emptied for a 304.
 *
 * WHAT A 304 MUST NOT CARRY. RFC 9111 has the cache UPDATE its stored response's
 * headers from the 304's, so any header sent here overwrites the one the reader
 * already has. The stored body carries the nonce from the render that produced
 * it; a fresh `Content-Security-Policy` would replace the stored one with a
 * policy naming a DIFFERENT nonce, and every inline script in the stored
 * document -- the Nuxt payload and the app's entry among them -- would be
 * blocked. The page would arrive blank with a console full of CSP violations.
 * Removing the header instead leaves stored body and stored policy agreeing on
 * the old nonce, which is self-consistent and is what the browser executes.
 * Verified in Chrome, not reasoned about: a 304-served page boots with no
 * violation reported.
 *
 * The CSP stays per-render on every 200, so nothing about the policy is
 * weakened -- a 304 has no body to apply a policy to.
 */
export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('beforeResponse', (event, response) => {
    // `beforeResponse` fires for everything Nitro answers, so the first job is to
    // recognise a rendered page. `ndCacheTier` is set by
    // `98-html-response-headers` and only after its `isReservedLocalePath` return,
    // so its presence is exactly "this is a page, not the `/api` proxy or a
    // sitemap". Public assets never get this far -- Nitro serves them first -- and
    // they carry their own strong ETag already.
    if (!event.context.ndCacheTier) return;

    // Anything the edge may store is deliberately left without a validator, and
    // this is the one part of the design that would be unsafe to relax. When
    // Cloudflare holds a copy it answers the conditional request itself, from its
    // own stored headers -- including that copy's CSP, with that copy's nonce. If
    // its object had been refreshed since the reader stored theirs, the two nonces
    // differ, the nonce-elided ETag still matches, and the reader gets a policy
    // that blocks their own stored body. Nothing here can strip a header from a
    // 304 Cloudflare generates, so shared-tier responses simply do not get an
    // ETag; they are already served from the edge and are not what this is for.
    if (event.context.ndShareable) return;

    // A conditional GET is only meaningful for a response that has a body to
    // suppress and a status that says the body is the page. 200 only, for the
    // same reason `02-shared-cache-header` insists on it: a 404 or a 302 is not a
    // representation anyone should be revalidating.
    if (event.method !== 'GET' && event.method !== 'HEAD') return;
    if (getResponseStatus(event) !== 200) return;
    if (typeof response.body !== 'string' || !response.body) return;

    const etag = htmlEtag(response.body, event.context.security?.nonce);
    setResponseHeader(event, 'ETag', etag);

    if (!ifNoneMatchSatisfied(getRequestHeader(event, 'if-none-match'), etag)) return;

    setResponseStatus(event, 304);
    response.body = '';
    removeResponseHeader(event, 'Content-Security-Policy');
    removeResponseHeader(event, 'Content-Security-Policy-Report-Only');
  });
});
