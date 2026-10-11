/** Use Cloudflare's country header instead of a GeoIP database; it is a coarse signup/location signal, never an
 * authorization or enforcement fact. */

/** Cloudflare's two-letter code, uppercased. */
const COUNTRY_CODE = /^[A-Z]{2}$/;

/** Drop Cloudflare's `XX` and `T1`: they match the two-letter shape but are not countries, while null already means
 * “unknown.” */
const NOT_A_COUNTRY = new Set(['XX', 'T1']);

/** Anything that can hand back a header by name: `Headers`, or a shim over one. */
export interface HeaderSource {
  get(name: string): string | null | undefined;
}

/** No usable header is an ordinary null for local, health-check, and direct-origin requests; it must not block
 * sign-in. */
export function countryFromHeaders(headers: HeaderSource | null | undefined): string | null {
  const raw = headers?.get('cf-ipcountry');
  if (!raw) return null;

  const code = raw.trim().toUpperCase();
  if (!COUNTRY_CODE.test(code)) return null;
  if (NOT_A_COUNTRY.has(code)) return null;

  return code;
}

/** Read headers from the same Better Auth context path used for session metadata; absent context simply yields null. */
export function countryFromAuthContext(context: unknown): string | null {
  const ctx = context as { headers?: HeaderSource; request?: { headers?: HeaderSource } } | null | undefined;
  return countryFromHeaders(ctx?.headers ?? ctx?.request?.headers);
}
