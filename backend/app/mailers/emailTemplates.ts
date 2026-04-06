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

export async function buildAnnouncementEmail(
  username: string,
  subject: string,
  message: string,
): Promise<{
  subject: string;
  html: string;
}> {
  const html = await renderTemplate('announcement', {
    username,
    subject,
    message,
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

export async function renderTemplate(templateName: string, variables: Record<string, string>): Promise<string> {
  const templatePath = path.join(__dirname, 'templates', `${templateName}.html`);

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
