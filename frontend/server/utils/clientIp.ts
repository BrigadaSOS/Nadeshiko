import type { H3Event } from 'h3';
import { getRequestHeader } from 'h3';

/**
 * Which address a per-visitor decision should key on.
 *
 * Sole caller today is the per-IP rate limiter (`ipRateLimit.ts`). It was
 * written for two: the SSR session cache keyed anonymous visitors by address as
 * well, and both answered the question separately, identically, and wrongly.
 * That second caller has since gone — the session lookup is skipped entirely
 * for requests with no session cookie, so there are no anonymous entries left
 * to key. The resolver stays here rather than being folded into the limiter,
 * because "who is this request from" is a question more than one thing has
 * needed and will need again.
 *
 * The bug both had: they read the *leftmost* `X-Forwarded-For` entry, which is
 * the one value in the chain a client can choose for itself.
 *
 * XFF is append-only and Cloudflare honours that: when a request already
 * carries the header, Cloudflare adds the connecting address to the end rather
 * than replacing what is there. So a client that sends
 * `X-Forwarded-For: 10.0.0.1` owns the leftmost slot, and rotating that value
 * mints a fresh rate-limit bucket on every request -- the limiter counts, it
 * just never counts the same visitor twice. `CF-Connecting-IP` carries no such
 * hazard: Cloudflare sets it on every proxied request and overwrites any
 * inbound copy, so it cannot be supplied from outside.
 *
 * WHAT THIS DOES AND DOES NOT BUY. Preferring `CF-Connecting-IP` is only as
 * strong as the guarantee that requests reach us *through* Cloudflare. Today
 * every hostname on the zone is proxied (`nadeshiko.co`, `api.`, `stg.`,
 * `api-stg.`, `cdn.`), so all traffic that knows a name arrives by that path
 * and this closes the rotation bypass for it. It does not defend against
 * someone who has learned the origin address and connects to it directly --
 * that requires the origin to refuse non-Cloudflare traffic, which is a
 * firewall question and not answerable from here. See the Cloudflare section of
 * DEPLOYMENT.md.
 *
 * The `X-Forwarded-For` fallback is deliberately kept rather than removed: it
 * is what local development and any non-Cloudflare path (a direct container
 * probe, a health check) resolve through. It is no weaker than what both
 * callers did before -- it is simply no longer the first choice.
 */
export function getClientIp(event: H3Event): string {
  // Set by Cloudflare on every proxied request, overwriting any inbound value.
  const cfConnectingIp = getRequestHeader(event, 'cf-connecting-ip')?.trim();
  if (cfConnectingIp) return cfConnectingIp;

  // Mirrors h3's getRequestIP({ xForwardedFor: true }) without depending on
  // event.context. Client-influenced -- see the note above.
  const xForwardedFor = getRequestHeader(event, 'x-forwarded-for')?.split(',').shift()?.trim();
  if (xForwardedFor) return xForwardedFor;

  return event.node?.req?.socket?.remoteAddress ?? 'unknown';
}
