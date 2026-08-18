/**
 * The small markdown subset the site-wide announcement banner understands.
 *
 * Deliberately not `marked`, which the blog uses. Those are markdown files in
 * the repo, read at build time and printed with `v-html`; an announcement is a
 * database row typed into an admin form and printed on every page of the site.
 * `marked` passes raw HTML straight through, so the same pipeline would turn one
 * careless -- or one stolen -- admin session into script running for every
 * visitor. Parsing to a node tree the renderer draws as elements means there is
 * no HTML string anywhere on this path to inject into: the failure mode is a
 * link that does not render, never a script that does.
 *
 * Inline only: links, bold, italic, code spans and hard line breaks. A banner is
 * a sentence or two with somewhere to click, and headings, lists and images are
 * shapes it has no room to draw.
 */

export type AnnouncementNode =
  | { type: 'text'; value: string }
  | { type: 'break' }
  | { type: 'code'; value: string }
  | { type: 'strong'; children: AnnouncementNode[] }
  | { type: 'em'; children: AnnouncementNode[] }
  | { type: 'link'; href: string; external: boolean; children: AnnouncementNode[] };

/** A backslash puts the next punctuation character through as itself. */
const ESCAPE = /^\\([\\`*[\]()])/;
const CODE = /^`([^`\n]+)`/;
/**
 * `[text](target)`. The target excludes whitespace and parentheses so the first
 * `)` always closes the link -- and, incidentally, so `javascript: alert(1)`
 * cannot match at all. `safeHref` is what actually decides; this is just shape.
 */
const LINK = /^\[([^\]\n]*)\]\(\s*([^()\s]+)\s*\)/;
const STRONG = /^\*\*([^\n]+?)\*\*/;
const EM = /^\*([^\n]+?)\*/;

/**
 * `_underscores_` are not emphasis here, only `*asterisks*`.
 *
 * The usual markdown rule needs word-boundary lookaround to keep `snake_case`
 * and `NUXT_PUBLIC_FOO` from turning into italics halfway through a word.
 * Announcements name things like that often enough, and `*` covers every case an
 * announcement actually needs, so the rule this file keeps is the one with no
 * surprising half.
 */
export function parseAnnouncement(message: string | null | undefined): AnnouncementNode[] {
  return parseInline(message ?? '');
}

function parseInline(input: string): AnnouncementNode[] {
  const nodes: AnnouncementNode[] = [];
  let pending = '';
  let i = 0;

  const flush = () => {
    if (!pending) return;
    nodes.push({ type: 'text', value: pending });
    pending = '';
  };

  while (i < input.length) {
    const rest = input.slice(i);

    const escaped = ESCAPE.exec(rest);
    if (escaped) {
      pending += escaped[1];
      i += escaped[0].length;
      continue;
    }

    if (rest.startsWith('\n')) {
      flush();
      nodes.push({ type: 'break' });
      i += 1;
      continue;
    }

    // Before the emphasis rules, so `*` and `[` inside a code span stay literal.
    const code = CODE.exec(rest);
    if (code) {
      flush();
      nodes.push({ type: 'code', value: code[1] as string });
      i += code[0].length;
      continue;
    }

    const link = LINK.exec(rest);
    if (link) {
      flush();
      const target = safeHref(link[2] as string);
      const label = parseInline(link[1] as string);
      // A link with no label would render as nothing to click, so it falls back
      // to showing where it goes.
      const children = label.length > 0 ? label : [{ type: 'text' as const, value: link[2] as string }];
      if (target) {
        nodes.push({ type: 'link', href: target.href, external: target.external, children });
      } else {
        // An unusable target loses the link and keeps the words. Dropping the
        // whole thing would silently delete text somebody wrote on purpose.
        nodes.push(...children);
      }
      i += link[0].length;
      continue;
    }

    // Before EM, or `**bold**` matches the italic rule and leaves stray asterisks.
    const strong = STRONG.exec(rest);
    if (strong) {
      flush();
      nodes.push({ type: 'strong', children: parseInline(strong[1] as string) });
      i += strong[0].length;
      continue;
    }

    const em = EM.exec(rest);
    if (em) {
      flush();
      nodes.push({ type: 'em', children: parseInline(em[1] as string) });
      i += em[0].length;
      continue;
    }

    pending += rest[0];
    i += 1;
  }

  flush();
  return nodes;
}

/**
 * Where a link may point, and whether it leaves the site.
 *
 * An allowlist, not a blocklist: anything this does not recognise is refused.
 * `javascript:` and `data:` are the reason the function exists, but naming them
 * is not the defence -- being unable to name them all is.
 */
function safeHref(raw: string): { href: string; external: boolean } | null {
  const url = raw.trim();

  // `//evil.com` is protocol-relative. It leaves the site while looking exactly
  // like a path that stays on it, which is the one case worth calling out.
  if (url.startsWith('//')) return null;
  if (url.startsWith('/')) return { href: url, external: false };
  if (/^https?:\/\/\S+$/i.test(url)) return { href: url, external: true };
  if (/^mailto:\S+$/i.test(url)) return { href: url, external: true };

  return null;
}

/** The message with its markup removed, for places that can only print text. */
export function announcementPlainText(message: string | null | undefined): string {
  const flatten = (nodes: AnnouncementNode[]): string =>
    nodes
      .map((node) => {
        switch (node.type) {
          case 'text':
            return node.value;
          case 'code':
            return node.value;
          case 'break':
            return ' ';
          default:
            return flatten(node.children);
        }
      })
      .join('');

  return flatten(parseAnnouncement(message));
}
