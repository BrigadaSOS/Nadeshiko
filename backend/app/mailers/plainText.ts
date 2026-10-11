/** Derive `text/plain` from HTML to preserve links and line breaks without maintaining a second, drifting copy of
 * each message. */
const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#039;': "'",
  '&apos;': "'",
  '&nbsp;': ' ',
  '&mdash;': '—',
  '&ndash;': '–',
  '&copy;': '©',
  '&middot;': '·',
  '&hellip;': '…',
};

function decodeEntities(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&[a-z]+;|&#039;/gi, (entity) => ENTITIES[entity.toLowerCase()] ?? entity);
}

export function htmlToPlainText(html: string): string {
  let text = html;

  // `<head>` is stylesheet and metadata; rendering it would put the whole CSS
  // block at the top of the message, which is worse than sending nothing.
  text = text.replace(/<head[\s\S]*?<\/head>/gi, '');
  text = text.replace(/<style[\s\S]*?<\/style>/gi, '');
  text = text.replace(/<script[\s\S]*?<\/script>/gi, '');

  // Preserve hrefs in plaintext; otherwise a magic-link email leaves only dead anchor text.
  text = text.replace(/<a\b[^>]*href=["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi, (_, href: string, label: string) => {
    // Strip `mailto:` before comparing anchor text to href, or an address renders twice.
    const rawHref = decodeEntities(href.trim());
    const cleanHref = rawHref.startsWith('mailto:') ? rawHref.slice('mailto:'.length) : rawHref;
    const cleanLabel = decodeEntities(label.replace(/<[^>]+>/g, '')).trim();

    if (!cleanLabel) return cleanHref;
    if (cleanLabel === cleanHref) return cleanHref;
    return `${cleanLabel} (${cleanHref})`;
  });

  // Use two newlines after paragraphs but none between list items; the next `<li>` already starts a line.
  text = text.replace(/<li\b[^>]*>/gi, '\n- ');
  text = text.replace(/<\/(li|tr)>/gi, '');
  text = text.replace(/<br\s*\/?>/gi, '\n');
  text = text.replace(/<\/(p|div|h[1-6]|ul|ol|table)>/gi, '\n\n');
  text = text.replace(/<[^>]+>/g, '');
  text = decodeEntities(text);

  return text
    .split('\n')
    .map((line) => line.replace(/[ \t ]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
