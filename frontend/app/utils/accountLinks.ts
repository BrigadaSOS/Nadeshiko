/**
 * Where linking a THIRD-PARTY account comes back to.
 *
 * These pages carry `code` and `state` exactly the way a sign-in callback does,
 * because both are OAuth redirects -- but they are not a sign-in, and anything
 * that reacts to those parameters has to be able to tell the two apart. The
 * auth-callback plugin could not, and claimed this page too: it toasted "signed
 * in" at a reader who already was, reported a login that never happened, and
 * replaced the route to strip the very query the page had come back to redeem.
 *
 * Matched on the path rather than on a marker parameter, because the redirect is
 * built by the OTHER service from a URI registered with it: there is nothing of
 * ours to put in it. The optional leading segment is the locale prefix i18n adds
 * (`/en/link/...`), which the registered URI does not carry but the redirect
 * lands on.
 */
const ACCOUNT_LINK_CALLBACK = /^\/(?:[a-z]{2}\/)?link\//;

export function isAccountLinkCallback(path: string): boolean {
  return ACCOUNT_LINK_CALLBACK.test(path);
}
