import { config } from '@config/config';

/**
 * Handing a message to ZeptoMail over HTTP instead of SMTP.
 *
 * WHY THIS FILE EXISTS: the SMTP handoff was costing FOUR TO SIX SECONDS per
 * message, measured on production, and the magic-link path pays that
 * synchronously while a reader watches a button. The relay is in Tokyo and the
 * app is not, so a fresh SMTP conversation -- TCP, STARTTLS, the TLS handshake,
 * AUTH, MAIL FROM, RCPT TO, DATA, QUIT -- spends roughly ten round trips before
 * ZeptoMail does any work. One HTTPS request spends one, and Node keeps the
 * connection alive for the next.
 *
 * The alternative was to queue the sign-in mail like everything else, and that
 * was rejected on purpose: `sendMagicLink` refuses a suppressed address OUT LOUD
 * and the caller needs that answer inside the request. Making the send
 * asynchronous would hand the reader a "check your inbox" screen for a message
 * we had already decided not to send -- the exact failure the sign-in work was
 * about ending.
 *
 * NO SMTP FALLBACK, deliberately, for the reason the SES branch was deleted: a
 * second transport nobody exercises is not a safety net, it is a second thing to
 * keep working. Staging shares this Agent and this code path, so the fallback
 * would only ever run in the one environment that had never tried it.
 */

/**
 * The Send Mail Token, which ZeptoMail uses for BOTH transports: as the SMTP
 * password, and here with a `Zoho-enczapikey` prefix. Read through
 * `ZEPTOMAIL_SEND_TOKEN` first so the two can be separated by configuration
 * alone if that ever stops being true, without a deploy of this file.
 */
function sendToken(lifecycle: boolean): string | undefined {
  // Lifecycle mail prefers its own Agent when one is configured; everything
  // falls back to the single token, which is the state today. See
  // `ZEPTOMAIL_LIFECYCLE_SEND_TOKEN` in the config for why the split exists.
  if (lifecycle && config.ZEPTOMAIL_LIFECYCLE_SEND_TOKEN) return config.ZEPTOMAIL_LIFECYCLE_SEND_TOKEN;

  return config.ZEPTOMAIL_SEND_TOKEN ?? config.SMTP_PASSWORD;
}

export interface ZeptomailMessage {
  /**
   * Whether this is lifecycle mail, which decides which Agent carries it.
   *
   * Passed rather than derived from the kind, because this module deliberately
   * knows nothing about `EmailKind` -- it is the transport, and `sendEmail` is
   * the one place that already answers this question for the From address too.
   */
  lifecycle?: boolean;
  from: { address: string; name: string };
  to: string;
  subject: string;
  html: string;
  text: string;
  replyTo?: string;
  /**
   * Returned on the bounce webhook as `client_reference`. A NATIVE FIELD here
   * rather than the `X-TM-CLIENT-REF` header SMTP needed: same value, same name
   * coming back, one less custom header to get wrong.
   */
  clientReference: string;
  unsubscribeUrl?: string;
}

/**
 * Ten seconds, which is long enough for a slow relay and short enough that a
 * hung request does not hold a sign-in open indefinitely. SMTP had no bound at
 * all, so a stalled connection was a stalled reader.
 */
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
      // RFC 8058. Both headers or neither: `List-Unsubscribe-Post` alone is
      // meaningless, and the URI alone gets a provider that opens it in a
      // browser rather than posting to it.
      //
      // `mime_headers` IS THE FIELD NAME, and the obvious `headers` is not.
      // ZeptoMail answers that one with `TM_3301 Bad Syntax`, `GE_121 An extra
      // key found in the input value, target: [headers]` -- a whole-request
      // rejection, so it would not have degraded to a message without an
      // unsubscribe link, it would have failed every lifecycle send outright.
      // Verified against the live JP API on 2026-08-21.
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

/**
 * What went wrong, in a form worth putting in a log line.
 *
 * The body is read defensively because an error from the edge rather than from
 * ZeptoMail itself (a 502 from a proxy, say) is not JSON, and a parse failure
 * here would replace a useful status code with a stack trace about JSON.
 *
 * NEVER INCLUDES THE REQUEST BODY, which holds the recipient and the message --
 * for a magic link that is a live credential, and delivery errors are exactly
 * the lines most likely to be pasted into a chat while somebody debugs.
 */
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
