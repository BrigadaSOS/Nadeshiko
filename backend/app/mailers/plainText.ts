/**
 * A `text/plain` alternative, derived from the HTML we already built.
 *
 * WHY EVERY MESSAGE NEEDS ONE. An HTML-only email is a spam-filter signal in its
 * own right -- a missing plaintext part is one of the oldest heuristics there
 * is, and it costs reputation on the single Agent that also carries magic
 * links. It is also the version that reaches a text-only client, a smartwatch
 * preview, and a screen reader that has given up on the markup. For the sign-in
 * mail specifically it is the difference between "no content" and a URL somebody
 * can still act on.
 *
 * DERIVED RATHER THAN HAND-WRITTEN, which is the deliberate trade. A second copy
 * of the words per template is a second copy to keep in step, and the one that
 * silently rots is the one nobody looks at. The cost is that this has to be a
 * competent little converter rather than a `replace(/<[^>]+>/g, '')`, because
 * the two things a plaintext reader actually needs -- the link targets and the
 * line breaks -- are exactly what naive tag-stripping destroys.
 */
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

  // THE PART THAT EARNS THIS FILE. A link whose href is dropped leaves "Sign in
  // to Nadeshiko" as dead words -- for a magic link, an unusable email. Anchor
  // text that already IS the URL is left alone rather than printed twice.
  text = text.replace(/<a\b[^>]*href=["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi, (_, href: string, label: string) => {
    // `mailto:` is scheme noise to somebody reading, and stripping it BEFORE the
    // comparison below is what stops `<a href="mailto:x@y">x@y</a>` -- which is
    // how every one of these templates writes a contact address -- rendering as
    // "x@y (x@y)".
    const rawHref = decodeEntities(href.trim());
    const cleanHref = rawHref.startsWith('mailto:') ? rawHref.slice('mailto:'.length) : rawHref;
    const cleanLabel = decodeEntities(label.replace(/<[^>]+>/g, '')).trim();

    if (!cleanLabel) return cleanHref;
    if (cleanLabel === cleanHref) return cleanHref;
    return `${cleanLabel} (${cleanHref})`;
  });

  // Block spacing, chosen rather than fallen into. A blank line between
  // PARAGRAPHS is how plaintext reads as prose; a blank line between LIST ITEMS
  // makes a three-item list look like three sections. So the closing tags that
  // end a paragraph get two newlines, and a list item gets none -- the `<li>`
  // that follows already starts its own line.
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
