import fs from 'fs';
import path from 'path';
import { config } from '@config/config';

function escapeHTML(str: string): string {
  return str
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function getLogoUrl(): string {
  return `${config.BASE_URL}/logo-38d6e06a.webp`;
}

export async function buildWelcomeEmail(username: string): Promise<{
  subject: string;
  html: string;
}> {
  const subject = 'Welcome to Nadeshiko!';
  const html = await renderTemplate('welcome', {
    username,
    baseUrl: config.BASE_URL,
    logoUrl: getLogoUrl(),
    year: getCurrentYear(),
  });

  return { subject, html };
}

export async function buildMagicLinkEmail(url: string): Promise<{ subject: string; html: string }> {
  const subject = 'Nadeshiko: Your sign-in link';
  const html = await renderTemplate('magic-link', {
    url,
    logoUrl: getLogoUrl(),
    year: getCurrentYear(),
  });

  return { subject, html };
}

export async function buildVerifyNewEmailEmail(url: string): Promise<{ subject: string; html: string }> {
  const subject = 'Nadeshiko: Verify your new email';
  const html = await renderTemplate('verify-new-email', {
    url,
    logoUrl: getLogoUrl(),
    year: getCurrentYear(),
  });

  return { subject, html };
}

export interface FeedbackEmailInput {
  /** Who it came from, already resolved to something readable. */
  from: string;
  message: string;
  /** One `Key: value` per line. Rendered verbatim inside a `pre`. */
  context: string;
}

/**
 * The notification we send ourselves when someone uses the feedback widget.
 *
 * The subject leads with the sender and the opening words of the message, so a
 * mailbox list is already triageable without opening anything. Truncated hard,
 * because a subject line that runs on is worse than one that stops.
 */
export async function buildFeedbackEmail(input: FeedbackEmailInput): Promise<{ subject: string; html: string }> {
  const subject = `\u{1F4AC} Feedback from ${input.from}: ${truncate(collapseWhitespace(input.message), 60)}`;
  const html = await renderTemplate('feedback', {
    from: input.from,
    message: input.message,
    context: input.context,
    logoUrl: getLogoUrl(),
    year: getCurrentYear(),
  });

  return { subject, html };
}

/** A newline in a subject line is a header-injection shape as well as an ugly one. */
function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1).trimEnd()}…`;
}

export async function renderTemplate(templateName: string, variables: Record<string, string>): Promise<string> {
  const templatePath = path.join(import.meta.dirname, 'templates', `${templateName}.html`);

  let html = await fs.promises.readFile(templatePath, 'utf-8');

  // Replace all {{key}} placeholders with escaped values
  for (const [key, value] of Object.entries(variables)) {
    html = html.replaceAll(`{{${key}}}`, escapeHTML(String(value)));
  }

  return html;
}

function getCurrentYear(): string {
  return new Date().getFullYear().toString();
}
