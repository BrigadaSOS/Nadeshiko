import fs from 'fs';
import path from 'path';

/**
 * The prose of an email, authored as Markdown instead of as markup.
 *
 * WHY THIS EXISTS. The templates carry two very different things: the card
 * chrome -- tables, inline styles, image slots, the button -- which has to be
 * HTML because that is what mail clients lay out, and the words, which do not.
 * Keeping both in one file meant every wording change involved scrolling past
 * `<table role="presentation" style="width: 100%; border-collapse...">`, and the
 * markup outnumbered the prose about three to one. Copy is the thing that gets
 * rewritten; it should be the thing that is easy to rewrite.
 *
 * DELIBERATELY NOT A MARKDOWN LIBRARY. A general parser emits `<p>` and `<ul>`
 * with no attributes, and an email needs every one of them carrying an inline
 * style, because a good share of clients drop the `<style>` block. So this
 * renders the four things these emails actually use -- paragraphs, bold, links
 * and bullet lists -- straight into the styles the templates already use, and
 * nothing else. If a fifth is ever genuinely needed, add it here rather than
 * reaching for a dependency that would have to be re-styled anyway.
 *
 * The blocks are addressed by name, so a template pulls the paragraph it wants
 * and the layout stays where layout belongs.
 */

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

/**
 * `**bold**` and `[text](url)`, applied after escaping.
 *
 * The order matters: escape first so a stray `<` in the copy renders as a `<`
 * rather than opening a tag, then add the tags we mean. Doing it the other way
 * round would escape the markup we just generated.
 */
function inline(text: string): string {
  return escapeHTML(text)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, `<a href="$2" style="${LINK}">$1</a>`);
}

/**
 * One block of Markdown as email-ready HTML.
 *
 * Paragraphs are separated by a blank line, which is the whole point of the
 * exercise: a newline in the source is a newline in the email, and nobody has
 * to type a `<p>` to get one.
 */
export function renderCopyBlock(markdown: string): string {
  const chunks = markdown.trim().split(/\n\s*\n/);

  return chunks
    .map((chunk) => {
      const lines = chunk
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);

      // A bullet list, if every line in the chunk is one. Mixed chunks are read
      // as a paragraph, because a half-list is far more likely to be a wrapped
      // sentence that happens to start with a dash than an intended list.
      if (lines.length > 0 && lines.every((line) => line.startsWith('- '))) {
        const items = lines
          .map((line) => `<li style="${LIST_ITEM}">${inline(line.slice(2))}</li>`)
          .join('\n            ');

        return `<ul style="${LIST}">\n            ${items}\n          </ul>`;
      }

      // `> ` is a note -- the small print under a button. These templates already
      // style it as `.expiry-note`, so this emits the class rather than a fourth
      // inline style, and Markdown's blockquote is the natural mark for an aside.
      //
      // A BARE `>` IS PART OF THE QUOTE, not prose that happens to start with
      // one. Requiring the trailing space read the empty marker line every
      // Markdown editor emits above a blockquote as an ordinary line, which made
      // `every` false and dropped the WHOLE chunk through to the paragraph
      // branch -- where `inline` escapes each `>` into a visible `&gt;`. That is
      // how the three notes in `verify-new-email` went out looking like a
      // forwarded reply while `magic-link`, which happens to have no blank
      // marker lines, rendered correctly the whole time.
      if (lines.every((line) => line === '>' || line.startsWith('> '))) {
        const note = lines
          .filter((line) => line !== '>')
          .map((line) => inline(line.slice(2)))
          .join('<br />\n            ');

        return `<p class="expiry-note">${note}</p>`;
      }

      // `#` is the card's own title -- the one big line at the top. Kept as an
      // `<h1>` with the class the card already styles, because unlike everything
      // else here it appears exactly once and has a home in the stylesheet.
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

/**
 * Splits a copy file into its named blocks.
 *
 * `## name` opens a block and everything up to the next one belongs to it, so a
 * file reads top to bottom as the email does rather than as a config object.
 */
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

/**
 * The copy for one email, keyed for `renderTemplate`.
 *
 * Prefixed with `copy.` so a template reads `{{{copy.intro}}}` and it is obvious
 * at the call site that the value is prose from the Markdown file rather than a
 * value the builder computed. Raw interpolation, because this IS markup by the
 * time it gets there -- and it is ours, generated above from a file in the repo,
 * never from anything a reader supplied.
 */
export async function loadCopy(name: string): Promise<Record<string, string>> {
  // SHARED FIRST, THE EMAIL'S OWN SECOND, so a local block of the same name
  // wins. The Discord banner is the same paragraph in three emails and would
  // drift into three slightly different paragraphs if each kept its own copy;
  // anything that genuinely needs to differ just declares that block locally.
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
