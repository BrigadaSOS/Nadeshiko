/**
 * Which country a sign-in or a sign-up came from, read off Cloudflare's own
 * header rather than looked up from an address.
 *
 * WHY THE HEADER AND NOT A GEOIP LOOKUP. `CF-IPCountry` is set at the edge on
 * every proxied request, costs nothing, and needs no database to keep current.
 * The alternative -- shipping a MaxMind file and resolving `ip_address`
 * ourselves -- buys city and coordinates we have no use for, and wariwari is the
 * cautionary tale: it defined eight geo columns against a real geoip gem and
 * populated exactly two of them, leaving region, city, latitude, longitude and
 * timezone NULL in 100% of its rows. Country is what the header gives and
 * country is all this stores.
 *
 * THIS REACHES US THROUGH THE SSR PROXY. Auth is not called from the browser
 * directly: it goes to `/v1/auth/**` on the Nuxt server, which forwards with
 * `getProxyRequestHeaders(event, { host: false })`, and `buildInternalBackendHeaders`
 * removes only its own three internal headers. So the reader's `CF-IPCountry`
 * survives the hop. `Feedback.country` is the proof it does in production --
 * that column is filled by the same header over the same path.
 *
 * WHAT IT IS NOT. Cloudflare derives this from the connecting address, exactly
 * as any geoip would, so a reader on a VPN reports the exit node's country. It
 * is not evidence of where somebody physically is, and nothing should be
 * enforced on it. What it is good for is the question it was added to answer:
 * of the accounts that exist, where were they opened and where are they used.
 */

/** Cloudflare's two-letter code, uppercased. */
const COUNTRY_CODE = /^[A-Z]{2}$/;

/**
 * Cloudflare sends `XX` when it cannot place the address, and `T1` for traffic
 * arriving over Tor. Both match the shape of a country and neither is one, so
 * they are dropped rather than stored -- a column that says `XX` reads like a
 * country nobody recognises, where null already means "we do not know".
 */
const NOT_A_COUNTRY = new Set(['XX', 'T1']);

/** Anything that can hand back a header by name: `Headers`, or a shim over one. */
export interface HeaderSource {
  get(name: string): string | null | undefined;
}

/**
 * The country for this request, or null when there isn't a usable one.
 *
 * Null is an ordinary answer, not a failure: local development, a health check,
 * a container probe and anything reaching the origin off-Cloudflare all arrive
 * without the header, and none of them should block a sign-in.
 */
export function countryFromHeaders(headers: HeaderSource | null | undefined): string | null {
  const raw = headers?.get('cf-ipcountry');
  if (!raw) return null;

  const code = raw.trim().toUpperCase();
  if (!COUNTRY_CODE.test(code)) return null;
  if (NOT_A_COUNTRY.has(code)) return null;

  return code;
}

/**
 * The same, from a better-auth hook context.
 *
 * better-auth's own `createSession` resolves the request headers as
 * `ctx?.headers || ctx?.request?.headers` -- that is how it fills `ip_address`
 * and `user_agent` -- so this reads them the same way and cannot disagree with
 * the address stored alongside it. The context is absent for a session or user
 * created outside a request (a seed, a test, an admin script), which is another
 * ordinary null.
 */
export function countryFromAuthContext(context: unknown): string | null {
  const ctx = context as { headers?: HeaderSource; request?: { headers?: HeaderSource } } | null | undefined;
  return countryFromHeaders(ctx?.headers ?? ctx?.request?.headers);
}
