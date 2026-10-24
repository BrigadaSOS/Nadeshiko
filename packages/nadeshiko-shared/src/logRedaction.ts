/**
 * The pino `redact` paths both services log behind.
 *
 * ONE COPY, READ BY BOTH RUNTIMES. These lists used to be maintained twice --
 * `backend/config/log.ts` and `frontend/server/utils/logger.ts` -- with nothing
 * holding them together, and they had already drifted: the backend redacted
 * `req.body.username`, `res.body.user.email` and `res.body.user.username` and
 * the frontend did not, while the frontend carried three unqualified keys the
 * backend lacked. A redaction list is the wrong place to discover a divergence
 * from its consequences, so it lives here now and neither side can move without
 * the other.
 *
 * Redaction is depth- and name-exact in pino: `res.body.user.email` does not
 * cover `res.body.owner.email`. Adding a path is cheap and missing one is not,
 * so prefer breadth.
 */

/** Credentials that ride on the request itself. */
const HEADERS = [
  'req.headers.cookie',
  'req.headers.authorization',
  'req.headers.set-cookie',
  'req.headers.x-internal-proxy-auth',
  'req.headers.x-rate-limit-bypass',
  // Session issuance and renewal return credentials even on successful responses.
  'res.headers.set-cookie',
];

/**
 * Query strings, which are the worst place for any of this to appear and the
 * likeliest to be captured whole by something upstream.
 */
const QUERY = [
  'req.query.password',
  'req.query.token',
  'req.query.api_key',
  'req.query.apiKey',
  'req.query.access_token',
  'req.query.refresh_token',
  'req.query.email',
  'req.query.code',
];

/** Both spellings of everything: the API takes camelCase, better-auth snake. */
const REQUEST_BODY = [
  'req.body.password',
  'req.body.currentPassword',
  'req.body.newPassword',
  'req.body.token',
  'req.body.accessToken',
  'req.body.refreshToken',
  'req.body.refresh_token',
  'req.body.apiKey',
  'req.body.api_key',
  'req.body.secret',
  'req.body.email',
  // OAuth codes. Short-lived, but exchangeable for a session by anyone holding
  // the log line before the reader finishes the round trip.
  'req.body.code',
  'req.body.otp',
  'req.body.username',
  // Social sign-in with a provider ID token is a bearer credential; `state` is
  // the OAuth CSRF binding; `newEmail` is the change-email address.
  'req.body.idToken',
  'req.body.state',
  'req.body.newEmail',
];

/** Anything we hand back that would be a credential in someone else's hands. */
const RESPONSE_BODY = [
  'res.body.token',
  'res.body.key',
  'res.body.apiKey',
  'res.body.api_key',
  'res.body.accessToken',
  'res.body.access_token',
  'res.body.refreshToken',
  'res.body.refresh_token',
];

/** Reader PII on the way back out. */
const RESPONSE_PII = ['res.body.user.email', 'res.body.user.username'];

/**
 * Unqualified, so they are caught wherever a log call puts them rather than only
 * on a serialized req/res. Cheap insurance against the next `logger.info({ token
 * })` written in a hurry.
 */
const BARE = ['apiKey', 'token', 'password'];

/**
 * Every path both runtimes redact. A service with response shapes of its own
 * appends to this rather than restating it -- see `VERBOSE_RESPONSE_PATHS` in
 * `backend/config/log.ts`, which trims bulk rather than hiding secrets.
 */
export const REDACT_PATHS: readonly string[] = [
  ...HEADERS,
  ...QUERY,
  ...REQUEST_BODY,
  ...RESPONSE_BODY,
  ...RESPONSE_PII,
  ...BARE,
];

/** Query parameters that carry a credential or an address: magic-link and email-preference tokens, OAuth codes. */
const SENSITIVE_QUERY_PARAMETERS = new Set([
  'password',
  'token',
  'access_token',
  'refresh_token',
  'api_key',
  'apikey',
  'email',
  'code',
]);

/**
 * A request URL fit for a log line or an error report: path and query kept, credential values replaced.
 * Mirrors `sanitizeRequestUrl` in `backend/config/log.ts`, which can switch to this copy.
 */
export function sanitizeRequestUrl(url: string): string {
  try {
    const parsed = new URL(url, 'http://localhost');
    for (const [name] of parsed.searchParams) {
      if (SENSITIVE_QUERY_PARAMETERS.has(name.toLowerCase())) {
        parsed.searchParams.set(name, '[Redacted]');
      }
    }
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    // A malformed URL must not make logging leak its unparsed query string.
    return url.split('?', 1)[0] ?? '';
  }
}
