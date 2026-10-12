import type { H3Event } from 'h3';
import { getRequestHeader } from 'h3';

// Trust CF-Connecting-IP only when the origin rejects non-Cloudflare traffic (see DEPLOYMENT.md).
// Cloudflare overwrites it; the leftmost X-Forwarded-For entry is client-controlled. The XFF fallback remains
// for local/non-Cloudflare paths and is not a trustworthy identity.
export function getClientIp(event: H3Event): string {
  const cfConnectingIp = getRequestHeader(event, 'cf-connecting-ip')?.trim();
  if (cfConnectingIp) return cfConnectingIp;

  // Mirror h3's XFF fallback without requiring event.context; this value is client-influenced.
  const xForwardedFor = getRequestHeader(event, 'x-forwarded-for')?.split(',').shift()?.trim();
  if (xForwardedFor) return xForwardedFor;

  return event.node?.req?.socket?.remoteAddress ?? 'unknown';
}
