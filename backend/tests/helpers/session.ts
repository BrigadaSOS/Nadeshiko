/** Return the `{ session, headers }` shape produced when `getSession` receives `returnHeaders`; the auth middleware
 * forwards the renewed cookie. A bare session makes it report a false missing-session result. */
export function sessionResult(session: unknown, setCookies: string[] = []) {
  const headers = new Headers();
  for (const cookie of setCookies) {
    headers.append('set-cookie', cookie);
  }

  return { headers, response: session };
}
