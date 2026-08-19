/**
 * The teaser paragraph on a blog card, as plain text.
 *
 * This used to be a regex markdown-to-HTML converter feeding `v-html`, and it
 * produced three separate defects because an excerpt is not a document:
 *
 *   - It wrapped every block in `<p>`, including blocks that were already raw
 *     HTML in the post, emitting `<p><div class="image-pair"></p></div>`. The
 *     browser re-parents that, which is a hydration mismatch on the blog index.
 *   - Its `<a href>` output landed inside the `NuxtLink` that wraps the whole
 *     card -- nested anchors, invalid, re-parented again.
 *   - Anything in angle brackets was parsed as a tag and vanished. The v2.1.0
 *     post reads "just type `/search <word>`", so the card advertised
 *     "just type /search " and swallowed the argument.
 *
 * Text has none of those failure modes, cannot mismatch on hydration, and drops
 * an HTML injection surface that only authored content kept safe. The card is a
 * few lines behind a fade gradient; the formatting was never legible there.
 */

/** Roughly what fits above the card's fade before it is truncated anyway. */
const MAX_CHARS = 400;

export function blogExcerpt(rawbody: string | null | undefined, fallback = ''): string {
  if (!rawbody) return fallback;

  const body = rawbody
    .replace(/^---[\s\S]*?---\n*/m, '') // frontmatter
    .replace(/```[\s\S]*?```/g, ' ') // fenced code
    .replace(/<[^>]*>/g, ' '); // raw HTML blocks and inline tags

  const text = body
    .split('\n')
    .filter((line) => {
      if (/^#{1,6}\s/.test(line)) return false; // headings
      if (/^!\[/.test(line)) return false; // images
      if (/^\s*$/.test(line)) return false;
      return true;
    })
    .slice(0, 10)
    // Bullet markers go per line, before the join: afterwards there are no line
    // starts left to anchor to, and a leading `*` would then read as emphasis.
    .map((line) => line.replace(/^\s*(?:[-*+]|\d+\.)\s+/, ''))
    .join(' ')
    // Unwrap the inline marks rather than rendering them: link text is the part
    // worth reading, and the URL is where the card already goes.
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();

  if (!text) return fallback;
  if (text.length <= MAX_CHARS) return text;

  // Cut on a space so the excerpt does not end mid-word.
  const clipped = text.slice(0, MAX_CHARS);
  const lastSpace = clipped.lastIndexOf(' ');
  return `${(lastSpace > 0 ? clipped.slice(0, lastSpace) : clipped).trimEnd()}…`;
}
