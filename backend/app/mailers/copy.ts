import fs from 'fs';
import path from 'path';

/** Keep email prose in small Markdown blocks; the renderer supports only the inline styles the templates need,
 * avoiding a general parser. */

/** The styles the card already uses, repeated inline because `<style>` is not reliable in mail. */
const PARAGRAPH = 'font-size: 15px; color: #a8a8a8; margin: 0 0 16px;';
const HEADING = 'font-size: 16px; font-weight: 600; color: #e8e8e8; margin: 0 0 4px;';
const LIST = 'margin: 0 0 16px; padding-left: 20px; color: #a8a8a8; font-size: 15px;';
const LIST_ITEM = 'margin-bottom: 6px;';
const LINK = 'color: #ef5552;';

function escapeHTML(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

/** Escape first, then add intended bold/link tags; reversing the order would escape the markup just generated. */
function inline(text: string): string {
  return escapeHTML(text)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, `<a href="$2" style="${LINK}">$1</a>`);
}

/** Blank lines delimit paragraphs, so copy authors need not write `<p>` markup. */
export function renderCopyBlock(markdown: string): string {
  const chunks = markdown.trim().split(/\n\s*\n/);

  return chunks
    .map((chunk) => {
      const lines = chunk
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);

      // Treat a chunk as a list only when every line is a bullet; mixed chunks remain paragraphs.
      if (lines.length > 0 && lines.every((line) => line.startsWith('- '))) {
        const items = lines
          .map((line) => `<li style="${LIST_ITEM}">${inline(line.slice(2))}</li>`)
          .join('\n            ');

        return `<ul style="${LIST}">\n            ${items}\n          </ul>`;
      }

      // `> ` emits the styled note; require the space so a blank marker line does not turn the whole chunk into visible
      // `&gt;` text.
      if (lines.every((line) => line === '>' || line.startsWith('> '))) {
        const note = lines
          .filter((line) => line !== '>')
          .map((line) => inline(line.slice(2)))
          .join('<br />\n            ');

        return `<p class="expiry-note">${note}</p>`;
      }

      // Render the single `#` title as the card’s styled `<h1>`.
      if (lines[0]?.startsWith('# ')) {
        const title = `<h1 class="card-title">${inline(lines[0].slice(2))}</h1>`;
        const rest = lines.slice(1).join(' ');

        return rest ? `${title}\n          <p style="${PARAGRAPH}">${inline(rest)}</p>` : title;
      }

      // `###` is a section heading -- the bold line above a paragraph, not an
      // `<h3>`, because these sit inside a card that already has its own title.
      if (lines[0]?.startsWith('### ')) {
        const heading = `<p style="${HEADING}">${inline(lines[0].slice(4))}</p>`;
        const rest = lines.slice(1).join(' ');

        return rest ? `${heading}\n          <p style="${PARAGRAPH}">${inline(rest)}</p>` : heading;
      }

      return `<p style="${PARAGRAPH}">${inline(lines.join(' '))}</p>`;
    })
    .join('\n          ');
}

/** `## name` opens a named block that runs until the next block, keeping copy files readable top to bottom. */
export function parseCopy(source: string): Record<string, string> {
  const blocks: Record<string, string> = {};
  let current: string | null = null;
  let buffer: string[] = [];

  const flush = () => {
    if (current) blocks[current] = renderCopyBlock(buffer.join('\n'));
    buffer = [];
  };

  for (const line of source.split('\n')) {
    const heading = /^##\s+([\w.-]+)\s*$/.exec(line);
    if (heading?.[1]) {
      flush();
      current = heading[1];
      continue;
    }
    buffer.push(line);
  }
  flush();

  return blocks;
}

/** Raw template interpolation is reserved for generated, already-escaped markup; never pass reader or database
 * values through it. */
export async function loadCopy(name: string): Promise<Record<string, string>> {
  // Merge shared blocks first and the email’s own blocks second, so local copy overrides shared copy.
  const [shared, own] = await Promise.all([read('shared'), read(name)]);

  return Object.fromEntries(Object.entries({ ...shared, ...own }).map(([key, html]) => [`copy.${key}`, html]));
}

async function read(name: string): Promise<Record<string, string>> {
  const file = path.join(import.meta.dirname, 'copy', `${name}.md`);

  try {
    return parseCopy(await fs.promises.readFile(file, 'utf-8'));
  } catch (error) {
    // Only a missing shared file is survivable; an email with no copy at all is
    // a broken message and should say so loudly rather than send blank.
    if (name === 'shared' && (error as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw error;
  }
}
