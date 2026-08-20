import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Transport } from 'nodemailer';
import { logger } from '@config/log';

/**
 * Local-only nodemailer transport modelled on Rails' letter_opener: instead of
 * handing the message to an SMTP server, it writes the rendered email to
 * backend/tmp/letter_opener/ and pops it open in the default browser. Magic
 * links are then one click away, with no third-party mailbox in the loop.
 */

export const LETTER_OPENER_DIR = path.resolve(import.meta.dirname, '../../tmp/letter_opener');

export interface LetterOpenerInfo {
  messageId: string;
  envelope: { from: string; to: string[] };
  accepted: string[];
  rejected: string[];
  filePath: string;
  previewUrl: string;
}

/**
 * Reads the browser preview URL off a transport result, if the transport
 * produced one. Real SMTP deliveries have none.
 */
export function getPreviewUrl(info: unknown): string | null {
  if (typeof info === 'object' && info !== null && 'previewUrl' in info) {
    const { previewUrl } = info as { previewUrl?: unknown };
    if (typeof previewUrl === 'string' && previewUrl) {
      return previewUrl;
    }
  }

  return null;
}

/**
 * Creates the letter-opener transport. Intended for the local environment only.
 */
export function createLetterOpenerTransport(): Transport<LetterOpenerInfo> {
  return {
    name: 'letter-opener',
    version: '1.0.0',

    send(mail, callback) {
      const data = mail.data;
      const messageId = `<${randomUUID()}@letter-opener.local>`;
      const from = formatAddresses(data.from);
      const to = formatAddressList(data.to);
      const subject = data.subject || '(no subject)';
      const body = contentToString(data.html) || `<pre>${escapeHtml(contentToString(data.text))}</pre>`;

      deliver({ messageId, from, to, subject, body })
        .then((filePath) => {
          callback(null, {
            messageId,
            envelope: { from, to },
            accepted: to,
            rejected: [],
            filePath,
            previewUrl: pathToFileURL(filePath).toString(),
          });
        })
        .catch((error: Error) => callback(error, undefined as never));
    },
  };
}

interface RenderedMessage {
  messageId: string;
  from: string;
  to: string[];
  subject: string;
  body: string;
}

/**
 * Writes the message to its own directory under tmp/letter_opener/ and opens it.
 * Returns the path of the written file.
 */
async function deliver(message: RenderedMessage): Promise<string> {
  const directory = path.join(LETTER_OPENER_DIR, `${timestampSlug()}_${slugify(message.subject)}`);
  await mkdir(directory, { recursive: true });

  const filePath = path.join(directory, 'rich.html');
  await writeFile(filePath, renderPage(message), 'utf8');

  // Vitest runs with ENVIRONMENT=local; a test that reaches the transport
  // should still leave the file behind, just not hijack the screen.
  if (!process.env.VITEST && process.env.NODE_ENV !== 'test') {
    openInBrowser(filePath);
  }

  return filePath;
}

/**
 * Wraps the email body in a page carrying a letter_opener-style envelope header.
 * The body keeps its own markup so links behave exactly as they would in a real
 * client; only a leading doctype is dropped, since this page supplies one.
 */
function renderPage(message: RenderedMessage): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escapeHtml(message.subject)}</title>
<style>
  #letter-opener {
    font: 14px/1.5 -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    color: #1f2933;
    background: #f5f6f8;
    border-bottom: 1px solid #d5d8dd;
    margin: 0 0 24px;
    padding: 16px 24px;
  }
  #letter-opener h1 { font-size: 16px; margin: 0 0 8px; }
  #letter-opener dl { display: grid; grid-template-columns: max-content 1fr; gap: 2px 12px; margin: 0; }
  #letter-opener dt { color: #6b7280; }
  #letter-opener dd { margin: 0; }
</style>
</head>
<body>
<div id="letter-opener">
  <h1>${escapeHtml(message.subject)}</h1>
  <dl>
    <dt>From</dt><dd>${escapeHtml(message.from)}</dd>
    <dt>To</dt><dd>${escapeHtml(message.to.join(', '))}</dd>
    <dt>Message-ID</dt><dd>${escapeHtml(message.messageId)}</dd>
  </dl>
</div>
${stripDoctype(message.body)}
</body>
</html>
`;
}

/**
 * Hands the file to the OS opener, detached, so a missing or slow opener never
 * blocks or crashes delivery.
 */
function openInBrowser(filePath: string): void {
  const command = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
  const args = process.platform === 'win32' ? ['', filePath] : [filePath];

  try {
    const child = spawn(command, args, {
      detached: true,
      stdio: 'ignore',
      shell: process.platform === 'win32',
    });
    child.on('error', (error) => {
      logger.warn({ err: error, filePath }, 'Could not open the email preview in a browser');
    });
    child.unref();
  } catch (error) {
    logger.warn({ err: error, filePath }, 'Could not open the email preview in a browser');
  }
}

function stripDoctype(html: string): string {
  return html.replace(/^\s*<!doctype[^>]*>/i, '');
}

function contentToString(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }

  if (Buffer.isBuffer(value)) {
    return value.toString('utf8');
  }

  return '';
}

function formatAddresses(value: unknown): string {
  return formatAddressList(value).join(', ');
}

function formatAddressList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((entry) => formatAddressList(entry));
  }

  if (typeof value === 'string') {
    return value ? [value] : [];
  }

  if (typeof value === 'object' && value !== null && 'address' in value) {
    const { address, name } = value as { address?: unknown; name?: unknown };
    if (typeof address !== 'string') {
      return [];
    }
    return [typeof name === 'string' && name ? `${name} <${address}>` : address];
  }

  return [];
}

function timestampSlug(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 60) || 'email'
  );
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
