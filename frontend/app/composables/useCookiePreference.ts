/**
 * Cookie options every reader preference shares. `encode`/`decode` are the
 * identity so the cookie holds exactly what `serialize` produced -- these values
 * are read by the server too, and JSON-encoding them would break that.
 */
export const PREFERENCE_COOKIE_OPTIONS = {
  maxAge: 60 * 60 * 24 * 365, // 1 year
  path: '/',
  sameSite: 'lax',
  encode: String,
  decode: String,
} as const;

export type CookiePreferenceCodec<T> = {
  /** Turns the raw cookie into the preference. Called with `null` when unset. */
  parse: (raw: string | null) => T;
  /** Turns the preference back into a cookie value; `null` clears the cookie. */
  serialize: (value: T) => string | null;
};

/**
 * Share a year-long cookie preference through useState. Re-read the server cookie even if
 * another caller already initialized the state key, avoiding a stale SSR payload.
 */
export function useCookiePreference<T>(cookieName: string, stateKey: string, codec: CookiePreferenceCodec<T>) {
  const cookie = useCookie<string | null>(cookieName, { ...PREFERENCE_COOKIE_OPTIONS });

  const state = useState<T>(stateKey, () => codec.parse(cookie.value ?? null));

  if (import.meta.server) {
    state.value = codec.parse(cookie.value ?? null);
  }

  /** Writes the preference to both the shared state and the cookie. */
  const set = (value: T) => {
    state.value = value;
    cookie.value = codec.serialize(value);
  };

  return { state, cookie, set };
}
