import { appendResponseHeader } from 'h3';
import type { H3Event } from 'h3';
import { SESSION_COOKIE, SESSION_COOKIE_PREFIXES } from '~~/server/utils/ssrAuthCache';

// Forward SSR session-token renewal to the browser, never the frequently rewritten session_data cache.
// Only personal HTML may carry these cookies: session requests must remain excluded from shared/edge caches.
export function renewedSessionCookies(headers: Headers | undefined | null): string[] {
  const entries = headers?.getSetCookie?.() ?? [];
  if (entries.length === 0) return [];

  // Accept all prefixes because the backend's secure-cookie configuration decides which it writes.
  return entries.filter((entry) =>
    SESSION_COOKIE_PREFIXES.some((prefix) => {
      const name = `${prefix}${SESSION_COOKIE}`;
      // Include chunked variants so a future large cookie is not forwarded partially.
      return entry.startsWith(`${name}=`) || entry.startsWith(`${name}.`);
    }),
  );
}

// Append to preserve cookies already written by the render.
export function applyRenewedSessionCookies(event: H3Event, cookies: string[]): void {
  for (const cookie of cookies) {
    appendResponseHeader(event, 'set-cookie', cookie);
  }
}
