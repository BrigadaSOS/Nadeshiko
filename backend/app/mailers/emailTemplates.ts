import fs from 'fs';
import path from 'path';
import { config } from '@config/config';

export async function buildWelcomeEmail(username: string): Promise<{
  subject: string;
  html: string;
}> {
  const subject = 'Welcome to Nadeshiko!';
  const html = await renderTemplate('welcome', {
    username,
    baseUrl: config.BASE_URL,
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
    year: getCurrentYear(),
  });

  return { subject, html };
}

export async function renderTemplate(templateName: string, variables: Record<string, string>): Promise<string> {
  const templatePath = path.join(__dirname, 'templates', `${templateName}.html`);

  let html = await fs.promises.readFile(templatePath, 'utf-8');

  // Replace all {{key}} placeholders with escaped values
  for (const [key, value] of Object.entries(variables)) {
    html = html.replaceAll(`{{${key}}}`, Bun.escapeHTML(String(value)));
  }

  return html;
}

function getCurrentYear(): string {
  return new Date().getFullYear().toString();
}
