import { describe, it, expect } from 'vitest';
import { parseAnnouncement, announcementPlainText, type AnnouncementNode } from './announcementMarkdown';

/** The shapes a node tree takes, flattened to something readable in a failure. */
function sketch(nodes: AnnouncementNode[]): string {
  return nodes
    .map((node) => {
      switch (node.type) {
        case 'text':
          return node.value;
        case 'break':
          return '<br>';
        case 'code':
          return `code(${node.value})`;
        case 'strong':
          return `b(${sketch(node.children)})`;
        case 'em':
          return `i(${sketch(node.children)})`;
        default:
          return `${node.external ? 'ext' : 'int'}(${node.href})[${sketch(node.children)}]`;
      }
    })
    .join('');
}

describe('parseAnnouncement', () => {
  it('leaves plain text alone', () => {
    expect(sketch(parseAnnouncement('Scheduled maintenance tonight.'))).toBe('Scheduled maintenance tonight.');
  });

  it('handles an empty or missing message', () => {
    expect(parseAnnouncement('')).toEqual([]);
    expect(parseAnnouncement(null)).toEqual([]);
    expect(parseAnnouncement(undefined)).toEqual([]);
  });

  describe('links', () => {
    it('marks a site path as internal', () => {
      expect(sketch(parseAnnouncement('See [the media page](/media).'))).toBe('See int(/media)[the media page].');
    });

    it('marks an http(s) address as external', () => {
      expect(sketch(parseAnnouncement('[our discord](https://discord.gg/x)'))).toBe(
        'ext(https://discord.gg/x)[our discord]',
      );
    });

    it('allows mailto', () => {
      expect(sketch(parseAnnouncement('[write in](mailto:hi@example.com)'))).toBe(
        'ext(mailto:hi@example.com)[write in]',
      );
    });

    it('formats inside the label', () => {
      expect(sketch(parseAnnouncement('[read **this**](/blog)'))).toBe('int(/blog)[read b(this)]');
    });

    it('falls back to the target when the label is empty', () => {
      expect(sketch(parseAnnouncement('[](/media)'))).toBe('int(/media)[/media]');
    });

    it('stops the link at the first closing paren', () => {
      expect(sketch(parseAnnouncement('[a](/media) (and more)'))).toBe('int(/media)[a] (and more)');
    });

    // The whole reason this parser exists rather than a markdown library.
    it('refuses a javascript: target and keeps the words', () => {
      expect(sketch(parseAnnouncement('[click me](javascript:alert(1))'))).toBe('[click me](javascript:alert(1))');
    });

    it('refuses a data: target', () => {
      expect(sketch(parseAnnouncement('[x](data:text/html;base64,PHNjcmlwdD4=)'))).toBe('x');
    });

    it('refuses a protocol-relative target that looks like a site path', () => {
      expect(sketch(parseAnnouncement('[x](//evil.example)'))).toBe('x');
    });
  });

  describe('emphasis', () => {
    it('reads bold before italic', () => {
      expect(sketch(parseAnnouncement('**bold** and *italic*'))).toBe('b(bold) and i(italic)');
    });

    it('leaves underscores alone so snake_case survives', () => {
      expect(sketch(parseAnnouncement('set NUXT_PUBLIC_FOO to _on_'))).toBe('set NUXT_PUBLIC_FOO to _on_');
    });

    it('leaves a lone asterisk as text', () => {
      expect(sketch(parseAnnouncement('2 * 3 = 6'))).toBe('2 * 3 = 6');
    });
  });

  it('keeps markup literal inside a code span', () => {
    expect(sketch(parseAnnouncement('run `npm run *dev*`'))).toBe('run code(npm run *dev*)');
  });

  it('turns a newline into a break', () => {
    expect(sketch(parseAnnouncement('one\ntwo'))).toBe('one<br>two');
  });

  it('puts an escaped character through as itself', () => {
    expect(sketch(parseAnnouncement('\\*not italic\\*'))).toBe('*not italic*');
  });

  // Nothing on this path builds an HTML string, so angle brackets are just text.
  it('treats raw HTML as the characters it is made of', () => {
    expect(sketch(parseAnnouncement('<script>alert(1)</script>'))).toBe('<script>alert(1)</script>');
  });
});

describe('announcementPlainText', () => {
  it('strips the markup down to what a reader would say out loud', () => {
    expect(announcementPlainText('See [the **media** page](/media), or run `npm i`.')).toBe(
      'See the media page, or run npm i.',
    );
  });
});
