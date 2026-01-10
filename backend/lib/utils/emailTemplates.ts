import fs from 'fs';
import path from 'path';

/**
 * Escapes HTML special characters to prevent XSS
 */
function escapeHtml(unsafe: string): string {
  return unsafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Renders a template by replacing {{key}} placeholders with values
 * @param templateName - Name of the template file (without .html extension)
 * @param variables - Object containing key-value pairs to replace
 * @returns Rendered HTML string
 */
export async function renderTemplate(templateName: string, variables: Record<string, string>): Promise<string> {
  const templatePath = path.join(__dirname, '../emails', `${templateName}.html`);

  let html = await fs.promises.readFile(templatePath, 'utf-8');

  // Replace all {{key}} placeholders with escaped values
  for (const [key, value] of Object.entries(variables)) {
    const placeholder = new RegExp(`\\{\\{${escapeRegex(key)}\\}\\}`, 'g');
    html = html.replace(placeholder, escapeHtml(String(value)));
  }

  return html;
}

/**
 * Escapes special regex characters
 */
function escapeRegex(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Gets the base URL from environment or uses default
 */
function getBaseUrl(): string {
  return process.env.ALLOWED_WEBSITE_URLS?.split(',')[0]?.trim() || 'https://nadeshiko.co';
}

/**
 * Gets current year for copyright
 */
function getCurrentYear(): string {
  return new Date().getFullYear().toString();
}

/**
 * Builds a welcome email
 * @param username - Username of the new user
 * @returns Object containing subject, html, and text versions
 */
export async function buildWelcomeEmail(username: string): Promise<{
  subject: string;
  html: string;
  text: string;
}> {
  const subject = 'Welcome to Nadeshiko!';
  const html = await renderTemplate('welcome', {
    username,
    baseUrl: getBaseUrl(),
    year: getCurrentYear(),
  });

  const text = `Welcome to Nadeshiko!

Hi ${username},

Thank you for joining Nadeshiko! We're excited to have you as part of our community.

What can you do with Nadeshiko?
- Search - Find specific words and phrases across anime, dramas, and audiobooks
- Context - See how words are used in real situations by native speakers
- Shadow - Practice pronunciation with native audio using our immersive player
- Lists - Save and organize your favorite segments and media

Start your journey by visiting ${getBaseUrl()}.

If you have any questions or feedback, feel free to reach out to us anytime.

© ${getCurrentYear()} Nadeshiko. All rights reserved.`;

  return { subject, html, text };
}

/**
 * Builds an announcement email
 * @param username - Username of the recipient
 * @param subject - Subject of the announcement
 * @param message - Message body (can contain HTML)
 * @returns Object containing subject, html, and text versions
 */
export async function buildAnnouncementEmail(
  username: string,
  subject: string,
  message: string,
): Promise<{
  subject: string;
  html: string;
  text: string;
}> {
  const html = await renderTemplate('announcement', {
    username,
    subject,
    message,
    year: getCurrentYear(),
  });

  // Strip HTML tags for text version
  const textMessage = message
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .trim();

  const text = `${subject}

Hi ${username},

${textMessage}

If you have any questions about this announcement, please don't hesitate to reach out to us.

© ${getCurrentYear()} Nadeshiko. All rights reserved.`;

  return { subject, html, text };
}
