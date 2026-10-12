import { getRequestHeader, getResponseStatus, removeResponseHeader, setResponseHeader, setResponseStatus } from 'h3';
import { htmlEtag, ifNoneMatchSatisfied } from '~~/server/utils/htmlEtag';

// Run at beforeResponse, after CSP/security hooks finish. On 304, remove CSP headers: caches update stored
// headers from the 304, and a new nonce would block scripts in the old stored body. Every 200 keeps its fresh CSP.
// Opt in only after checking the edge preserves HTML ETags. Cloudflare rewriting can strip them, making
// canonicalization a wasted full-document copy. Enable with NUXT_HTML_CONDITIONAL_GET=1.
const ENABLED = process.env.NUXT_HTML_CONDITIONAL_GET === '1';

export default defineNitroPlugin((nitroApp) => {
  if (!ENABLED) return;

  nitroApp.hooks.hook('beforeResponse', (event, response) => {
    // Only page middleware sets ndCacheTier; API responses and assets have their own validators.
    if (!event.context.ndCacheTier) return;

    // Never validate shared HTML: a CDN-generated 304 can overwrite the browser's old CSP with a different nonce
    // while the nonce-elided ETag still matches. We cannot strip headers from a 304 generated at the edge.
    if (event.context.ndShareable) return;

    // Only successful GET/HEAD page representations can be revalidated.
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
