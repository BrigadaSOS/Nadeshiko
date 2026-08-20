/**
 * The shape `auth.api.getSession` answers with once the caller asks for
 * `returnHeaders`, which `requireSessionAuth` does so it can forward the
 * renewed session cookie (see the middleware for why that matters).
 *
 * Wrapped in a helper rather than written out at every mock site because the
 * envelope is easy to get subtly wrong: a mock resolving the bare session --
 * what these tests used before -- makes the middleware destructure `undefined`
 * off a plain object and report a *missing* session, so the test passes for the
 * wrong reason or fails somewhere unrelated.
 */
export function sessionResult(session: unknown, setCookies: string[] = []) {
  const headers = new Headers();
  for (const cookie of setCookies) {
    headers.append('set-cookie', cookie);
  }

  return { headers, response: session };
}
