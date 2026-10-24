import {
  DeleteSuppressedDestinationCommand,
  NotFoundException,
  SESv2Client,
  SendEmailCommand,
  type MessageTag,
} from '@aws-sdk/client-sesv2';
import { NodeHttpHandler } from '@smithy/node-http-handler';
import { Agent } from 'node:https';
import { config } from '@config/config';

/** Send over the SES HTTPS API, never SMTP: sign-in mail is sent inline, and an SMTP conversation costs a reader
 * seconds per message. One client per process keeps the TLS connection warm between sends. */

export interface OutboundMessage {
  from: { address: string; name: string };
  to: string;
  subject: string;
  html: string;
  text: string;
  replyTo?: string;
  /** `kind` or `kind:campaign`. Travels as SES message tags and returns on every bounce and complaint, which is the
   * only thing tying an event back to which mail we sent. */
  clientReference: string;
  unsubscribeUrl?: string;
}

/** Bound relay calls so a stalled connection cannot hold sign-in open indefinitely. */
const REQUEST_TIMEOUT_MS = 10_000;

let client: SESv2Client | null = null;

/** Reset the memoized client in tests; otherwise the first test's credentials stick for the whole run. */
export function resetSesClientForTests(): void {
  client = null;
}

function getClient(): SESv2Client {
  if (client) return client;

  const accessKeyId = config.SES_AWS_ACCESS_KEY_ID;
  const secretAccessKey = config.SES_AWS_SECRET_ACCESS_KEY;
  if (!accessKeyId || !secretAccessKey) {
    throw new Error('SES credentials are not configured (set SES_AWS_ACCESS_KEY_ID and SES_AWS_SECRET_ACCESS_KEY).');
  }

  client = new SESv2Client({
    region: config.SES_AWS_REGION,
    credentials: { accessKeyId, secretAccessKey },
    requestHandler: new NodeHttpHandler({
      httpsAgent: new Agent({ keepAlive: true }),
      connectionTimeout: REQUEST_TIMEOUT_MS,
      requestTimeout: REQUEST_TIMEOUT_MS,
    }),
    // One attempt: a retried inline send doubles a reader's wait, and the caller already reports the failure.
    maxAttempts: 1,
  });
  return client;
}

/** SES tag values allow only `[A-Za-z0-9_-]`, so `kind:campaign` travels as two tags and is rebuilt from the event. */
export function referenceToTags(clientReference: string): MessageTag[] {
  const [kind, ...rest] = clientReference.split(':');
  const tags: MessageTag[] = [{ Name: 'kind', Value: sanitizeTag(kind) }];
  const campaign = rest.join(':');
  if (campaign) tags.push({ Name: 'campaign', Value: sanitizeTag(campaign) });
  return tags;
}

function sanitizeTag(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 256) || 'unknown';
}

export async function sendViaSes(message: OutboundMessage): Promise<void> {
  if (!config.SES_CONFIGURATION_SET) {
    // Refuse rather than send blind: without the configuration set SES publishes no bounce events at all.
    throw new Error('SES_CONFIGURATION_SET is not configured.');
  }

  await getClient().send(
    new SendEmailCommand({
      FromEmailAddress: `${message.from.name} <${message.from.address}>`,
      Destination: { ToAddresses: [message.to] },
      ...(message.replyTo ? { ReplyToAddresses: [message.replyTo] } : {}),
      ConfigurationSetName: config.SES_CONFIGURATION_SET,
      EmailTags: referenceToTags(message.clientReference),
      Content: {
        Simple: {
          Subject: { Data: message.subject, Charset: 'UTF-8' },
          Body: {
            Html: { Data: message.html, Charset: 'UTF-8' },
            // Never omitted. An HTML-only message is one of the oldest spam heuristics, and it costs reputation on
            // the identity that also carries sign-in -- see `htmlToPlainText`.
            Text: { Data: message.text, Charset: 'UTF-8' },
          },
          // RFC 8058 one-click unsubscribe, on lifecycle mail only.
          ...(message.unsubscribeUrl
            ? {
                Headers: [
                  { Name: 'List-Unsubscribe', Value: `<${message.unsubscribeUrl}>` },
                  { Name: 'List-Unsubscribe-Post', Value: 'List-Unsubscribe=One-Click' },
                ],
              }
            : {}),
        },
      },
    }),
    { abortSignal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) },
  );
}

/** Remove an address from SES's account-level suppression list. True when SES no longer holds it, including when it
 * never did: a lift's goal is that SES stops refusing the address. */
export async function deleteSesSuppression(address: string): Promise<boolean> {
  try {
    await getClient().send(new DeleteSuppressedDestinationCommand({ EmailAddress: address }), {
      abortSignal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    return true;
  } catch (error) {
    if (error instanceof NotFoundException) return true;
    throw error;
  }
}
