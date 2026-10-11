import { config } from '@config/config';
import { logger } from '@config/log';

/** Provider and application suppression lists are separate; missing credentials must report an incomplete lift, not
 * a false success or crash. */

const TOKEN_TTL_MS = 50 * 60 * 1000;

/** Cache the provider token per process; this infrequent operation does not justify shared-cache infrastructure. */
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

    // “Not found” already means the address is absent from the provider list, so it is successful for a lift.
    if (await isNotFound(response)) return true;

    // Retry once with a fresh provider token on 401; the provider clock, not the local cache TTL, decides token
    // validity.
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

/** ZeptoMail expects `values` as an array even when deleting one address; keep the provider-specific request shape
 * explicit. */
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
