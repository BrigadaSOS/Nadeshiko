import { appendResponseHeader } from 'h3';
import type { H3Event } from 'h3';
import { SESSION_COOKIE, SESSION_COOKIE_PREFIXES } from '~~/server/utils/ssrAuthCache';

/**
 * Passes on the session cookie the backend renewed, so a reader who only ever
 * loads pages stays signed in.
 *
 * Sessions slide: the backend gives them 30 days and pushes that back out once
 * a session is a week old (`backend/config/auth.ts`). Two things have to move
 * for that to be true from the reader's side -- the row in Postgres AND the
 * `Max-Age` on the cookie in their browser -- and the SSR bootstrap moved only
 * the first. It asks the backend who the visitor is on every render, which is
 * what triggers the renewal, but it asks over a server-to-server `$fetch`: the
 * `Set-Cookie` that comes back lands in a variable and is dropped, because
 * nothing was forwarding it onto the response the browser is actually waiting
 * for. The row said the session was good for another month; the browser deleted
 * the cookie 30 days after sign-in and the reader was signed out mid-visit.
 *
 * This is the half that covers readers who never make a client-side API call --
 * the ones who load a page, read it, and leave. They are also the readers most
 * likely to be approaching the 30-day mark in the first place, so they are
 * exactly who the fix is for. `requireSessionAuth` in the backend covers the
 * other half, every `/v1` call the browser makes itself.
 *
 * Only the session token is forwarded, never the `session_data` cookie cache:
 * that one is rewritten on every single call and is a five-minute read cache,
 * so forwarding it would put a kilobyte on every HTML response and on every
 * request the browser sent afterwards, renewing nothing that decides when
 * anyone is signed out.
 *
 * Safe to append to an HTML response because a request carrying a session
 * cookie is classified `personal` by `visitorCacheTier`, so it never gets
 * `CDN-Cache-Control` and never matches a Cloudflare cache rule (they are all
 * conditioned on the absence of this very cookie). Re-check that before
 * shared-caching anything a signed-in reader can request.
 */
export function renewedSessionCookies(headers: Headers | undefined | null): string[] {
  const entries = headers?.getSetCookie?.() ?? [];
  if (entries.length === 0) return [];

  // Every prefix, because which one the backend writes depends on its
  // `useSecureCookies` and not on anything visible from here -- the same reason
  // `getSessionKey` reads all three when it looks for the cookie coming in.
  return entries.filter((entry) =>
    SESSION_COOKIE_PREFIXES.some((prefix) => {
      const name = `${prefix}${SESSION_COOKIE}`;
      // `${name}.` catches the chunked variants better-auth writes for a cookie
      // that outgrows 4KB; the token never has, but half a cookie forwarded
      // silently would be a bad way to find out that changed.
      return entry.startsWith(`${name}=`) || entry.startsWith(`${name}.`);
    }),
  );
}

/**
 * Appends rather than sets: the render may already be writing cookies of its
 * own (the preferences stamp, a locale choice), and `setResponseHeader` would
 * drop them.
 */
export function applyRenewedSessionCookies(event: H3Event, cookies: string[]): void {
  for (const cookie of cookies) {
    appendResponseHeader(event, 'set-cookie', cookie);
  }
}
