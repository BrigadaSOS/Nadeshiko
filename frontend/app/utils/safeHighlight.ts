/**
 * Escapes corpus text while retaining the two elements produced by the search
 * highlighter. This is intentionally a tiny allowlist rather than a general
 * HTML sanitizer: segment content is text, and `em` plus the tail marker are
 * the only markup the UI has a reason to render.
 */
const ALLOWED_HIGHLIGHT_TAG =
  /<em\s*>|<\/em\s*>|<span\s+class\s*=\s*(?:"highlight-tail"|'highlight-tail')\s*>|<\/span\s*>/gi;

export const escapeCorpusText = (content: unknown): string => {
  const text = String(content ?? '');
  return text.replace(/[&<>"']/g, (character) => {
    switch (character) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      case "'":
        return '&#39;';
      default:
        return character;
    }
  });
};

export function safeHighlight(content: unknown): string {
  const input = String(content ?? '');
  let output = '';
  let position = 0;

  for (const match of input.matchAll(ALLOWED_HIGHLIGHT_TAG)) {
    const index = match.index ?? 0;
    output += escapeCorpusText(input.slice(position, index));
    // The regular expression only yields static, known-safe tags. Normalizing
    // them also strips any irrelevant whitespace/casing from backend output.
    const tag = match[0].toLowerCase().replace(/\s+/g, '');
    output += tag === '<em>' || tag === '</em>' || tag === '</span>' ? tag : '<span class="highlight-tail">';
    position = index + match[0].length;
  }

  return output + escapeCorpusText(input.slice(position));
}
