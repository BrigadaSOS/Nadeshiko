import crypto from 'node:crypto';
import { config } from '@config/config';

/** SNS authenticates to the webhook with basic auth embedded in the subscription URL
 * (`https://sns:<secret>@api.nadeshiko.co/v1/webhooks/ses`). The username is ignored; the password is the secret. */

/** Read through functions because frozen module config is not a test seam; do not mutate config inside a hook. */
export function getWebhookSecret(): string | undefined {
  return config.SES_WEBHOOK_SECRET;
}

export function getTopicArn(): string | undefined {
  return config.SES_SNS_TOPIC_ARN;
}

export function basicAuthPassword(header: string | undefined): string | null {
  if (!header?.startsWith('Basic ')) return null;
  const decoded = Buffer.from(header.slice('Basic '.length).trim(), 'base64').toString('utf8');
  const colon = decoded.indexOf(':');
  return colon === -1 ? null : decoded.slice(colon + 1);
}

export function passwordMatches(password: string | null, secret: string): boolean {
  if (!password) return false;
  const given = crypto.createHash('sha256').update(password).digest();
  const expected = crypto.createHash('sha256').update(secret).digest();
  return crypto.timingSafeEqual(given, expected);
}

/** Only follow confirmation links on SNS's own HTTPS host; the URL comes from the request body. */
export function isSnsSubscribeUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && /^sns\.[a-z0-9-]+\.amazonaws\.com$/.test(url.hostname);
  } catch {
    return false;
  }
}
