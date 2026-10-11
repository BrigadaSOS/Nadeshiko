import { config } from '@config/config';

/** Use ZeptoMail HTTP for synchronous sign-in mail: it keeps the request bounded and preserves suppression errors;
 * do not add an untested SMTP fallback. */

/** Read the provider token through `ZEPTOMAIL_SEND_TOKEN` so transport-specific credentials can diverge later
 * without changing this module. */
function sendToken(lifecycle: boolean): string | undefined {
  // Prefer the lifecycle Agent when configured; otherwise use the current shared token.
  if (lifecycle && config.ZEPTOMAIL_LIFECYCLE_SEND_TOKEN) return config.ZEPTOMAIL_LIFECYCLE_SEND_TOKEN;

  return config.ZEPTOMAIL_SEND_TOKEN ?? config.SMTP_PASSWORD;
}

export interface ZeptomailMessage {
  /** Pass lifecycle status from `sendEmail`; the transport must not duplicate `EmailKind` policy. */
  lifecycle?: boolean;
  from: { address: string; name: string };
  to: string;
  subject: string;
  html: string;
  text: string;
  replyTo?: string;
  /** Use the provider’s native client-reference field so bounce callbacks retain the same attribution without a
   * custom SMTP header. */
  clientReference: string;
  unsubscribeUrl?: string;
}

/** Bound relay calls so a stalled connection cannot hold sign-in open indefinitely. */
const REQUEST_TIMEOUT_MS = 10_000;

export async function sendViaZeptomailApi(message: ZeptomailMessage): Promise<void> {
  const token = sendToken(message.lifecycle === true);
  if (!token) {
    throw new Error('ZeptoMail send token is not configured (set SMTP_PASSWORD, or ZEPTOMAIL_SEND_TOKEN).');
  }

  const response = await fetch(`https://${config.ZEPTOMAIL_API_HOST}/v1.1/email`, {
    method: 'POST',
    headers: {
      // The prefix is part of the credential's format, not a scheme name we
      // chose: ZeptoMail rejects the bare token.
      Authorization: `Zoho-enczapikey ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      from: { address: message.from.address, name: message.from.name },
      to: [{ email_address: { address: message.to } }],
      subject: message.subject,
      htmlbody: message.html,
      // Never omitted. An HTML-only message is one of the oldest spam
      // heuristics there is, and it costs reputation on the Agent that also
      // carries sign-in -- see `htmlToPlainText`.
      textbody: message.text,
      client_reference: message.clientReference,
      ...(message.replyTo ? { reply_to: [{ address: message.replyTo }] } : {}),
      // Send both RFC 8058 fields via `mime_headers`; `headers` rejects the whole ZeptoMail request.
      ...(message.unsubscribeUrl
        ? {
            mime_headers: {
              'List-Unsubscribe': `<${message.unsubscribeUrl}>`,
              'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
            },
          }
        : {}),
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (response.ok) return;

  throw new Error(`ZeptoMail refused the message: ${await describeFailure(response)}`);
}

/** Never include the request body in errors: recipients and message content may contain a live magic-link
 * credential. */
async function describeFailure(response: Response): Promise<string> {
  let detail = '';

  try {
    const body = (await response.json()) as { error?: { code?: string; message?: string } };
    const code = body?.error?.code;
    const text = body?.error?.message;
    detail = [code, text].filter(Boolean).join(' ');
  } catch {
    detail = '';
  }

  return detail ? `${response.status} ${detail}` : `HTTP ${response.status}`;
}
