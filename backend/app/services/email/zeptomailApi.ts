import { config } from '@config/config';
import { logger } from '@config/log';

/**
 * The thin half of ZeptoMail we actually call: its own suppression list.
 *
 * WHY THIS EXISTS AT ALL, because it is not obvious and the answer decides
 * whether the lift path is honest.
 *
 * Auto-suppression of hard bounces is enabled on the Agent, deliberately -- it
 * stops repeat sends the instant ZeptoMail knows, whether or not our webhook is
 * healthy. That means ZeptoMail keeps a suppression list of its OWN. So when we
 * forgive an address, deleting our row clears only our half: the app now believes
 * it can write to that person and the relay silently still refuses. Both halves
 * look fine on their own and nothing reports the disagreement, which is a worse
 * state to be in than either "suppressed" or "not suppressed".
 *
 * INERT WITHOUT CREDENTIALS, and says so out loud. Lifting our own row is still
 * worth doing, and a missing client id should not turn an operator's lift into a
 * crash -- but it must not quietly report success either, because the address
 * really is still refused at the relay.
 */

const TOKEN_TTL_MS = 50 * 60 * 1000;

/**
 * In-process, because there is no shared cache in this app and this call happens
 * a handful of times a year. A per-process token is exactly right at that rate;
 * reaching for Redis to hold it would be new infrastructure for nothing.
 */
let cachedToken: { value: string; expiresAt: number } | null = null;

export function isZohoConfigured(): boolean {
  return Boolean(config.ZOHO_CLIENT_ID && config.ZOHO_CLIENT_SECRET && config.ZOHO_REFRESH_TOKEN);
}

/**
 * Returns true only when ZeptoMail confirms the address is off its list. A
 * `false` means the caller must say the provider half is still standing.
 */
export async function deleteProviderSuppression(address: string): Promise<boolean> {
  if (!isZohoConfigured()) {
    logger.warn(
      'No Zoho OAuth client configured, so the address is still suppressed at the relay. ' +
        'Remove it by hand in the ZeptoMail console.',
    );
    return false;
  }

  const token = await accessToken();
  if (!token) return false;

  try {
    const response = await deleteRequest(token, address);

    if (response.ok) return true;

    // "Not found" IS SUCCESS HERE, and treating it as a failure was the first
    // thing this code got wrong in testing.
    //
    // The goal of a lift is that ZeptoMail is not refusing the address any more.
    // If it never had the address on its list -- because we suppressed it
    // manually, or auto-suppression had not fired -- then that goal is already
    // met, and reporting failure would make every such lift exit non-zero and
    // send somebody hunting for a problem that does not exist.
    if (await isNotFound(response)) return true;

    // A rejected token is worth one retry with a fresh one: the cache holds a
    // token for fifty minutes against a stated hour, but the clock that matters
    // is Zoho's, and an unlucky boundary should not read as a failed lift.
    if (response.status === 401) {
      cachedToken = null;
      const retryToken = await accessToken();
      if (retryToken) {
        const retry = await deleteRequest(retryToken, address);
        if (retry.ok || (await isNotFound(retry))) return true;
      }
    }

    logger.warn({ status: response.status }, 'ZeptoMail refused a suppression delete');
    return false;
  } catch (error) {
    logger.warn({ err: error }, 'ZeptoMail was unreachable for a suppression delete');
    return false;
  }
}

/**
 * `values` IS AN ARRAY, and it is the detail most likely to be got wrong.
 *
 * The obvious reading of "delete this one address" is `{ value: "..." }`, and
 * that is what shirabe shipped. ZeptoMail answers it with
 * `SERR_110 "Parameter less than min occurrance", target: "values"` -- a Bad
 * Syntax error naming a field the request never sent, which reads like a server
 * problem rather than our own. Verified against the live JP API on 2026-08-20.
 */
function deleteRequest(token: string, address: string): Promise<Response> {
  return fetch(`https://${config.ZEPTOMAIL_API_HOST}/v1.1/suppressions/email`, {
    method: 'DELETE',
    headers: {
      Authorization: `Zoho-oauthtoken ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ values: [address] }),
    signal: AbortSignal.timeout(10_000),
  });
}

/** ZeptoMail says `DND_102` when the address is not on its suppression list. */
async function isNotFound(response: Response): Promise<boolean> {
  try {
    const body = (await response.clone().json()) as { error?: { code?: string } };
    return body?.error?.code === 'DND_102';
  } catch {
    return false;
  }
}

/**
 * Zoho access tokens last an hour. Cached just under that, so a burst of lifts is
 * one token exchange rather than one each.
 */
async function accessToken(): Promise<string | null> {
  if (cachedToken && cachedToken.expiresAt > Date.now()) return cachedToken.value;

  const body = new URLSearchParams({
    refresh_token: config.ZOHO_REFRESH_TOKEN ?? '',
    client_id: config.ZOHO_CLIENT_ID ?? '',
    client_secret: config.ZOHO_CLIENT_SECRET ?? '',
    grant_type: 'refresh_token',
  });

  try {
    const response = await fetch(`https://${config.ZOHO_ACCOUNTS_HOST}/oauth/v2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      logger.warn({ status: response.status }, 'Zoho token refresh failed');
      return null;
    }

    const json = (await response.json()) as { access_token?: string };
    if (!json.access_token) {
      // Zoho answers 200 with an `error` field for a revoked refresh token, so a
      // successful status is not on its own evidence that we hold a token.
      logger.warn('Zoho token refresh returned no access token');
      return null;
    }

    cachedToken = { value: json.access_token, expiresAt: Date.now() + TOKEN_TTL_MS };
    return json.access_token;
  } catch (error) {
    logger.warn({ err: error }, 'Zoho accounts host was unreachable');
    return null;
  }
}

/** Test seam: the module-level cache would otherwise leak between cases. */
export function resetTokenCache(): void {
  cachedToken = null;
}
