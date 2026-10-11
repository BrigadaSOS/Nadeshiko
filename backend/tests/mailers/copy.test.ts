import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseCopy, renderCopyBlock, loadCopy } from '@app/mailers/copy';

/** Escape Markdown-rendered email output before it reaches `renderTemplate`'s RAW path; that path performs no
 * escaping of its own. */
describe('renderCopyBlock', () => {
  it('makes a blank line a new paragraph, which is the whole point', () => {
    const html = renderCopyBlock('First thing.\n\nSecond thing.');

    expect(html.match(/<p /g)).toHaveLength(2);
    expect(html).toContain('First thing.');
    expect(html).toContain('Second thing.');
  });

  /** A wrapped sentence in the source is still one sentence in the email. */
  it('joins lines within a paragraph rather than breaking them', () => {
    const html = renderCopyBlock('One sentence\nwrapped over two lines.');

    expect(html.match(/<p /g)).toHaveLength(1);
    expect(html).toContain('One sentence wrapped over two lines.');
  });

  it('carries the styles inline, because a good share of clients drop the style block', () => {
    expect(renderCopyBlock('Body copy.')).toContain('font-size: 15px');
  });

  it('renders the card title, the section heading and the note distinctly', () => {
    expect(renderCopyBlock('# Welcome')).toContain('<h1 class="card-title">Welcome</h1>');
    expect(renderCopyBlock('### A section')).toContain('font-weight: 600');
    expect(renderCopyBlock('> Small print.')).toContain('<p class="expiry-note">Small print.</p>');
  });

  /** A blank marker line can precede a blockquote; classify the whole chunk correctly or its markers are emitted as
   * visible `&gt;` text. */
  it('reads a bare > as part of the quote rather than as prose', () => {
    const html = renderCopyBlock('>\n> Small print.\n> Second line.');

    expect(html).toContain('<p class="expiry-note">');
    expect(html).not.toContain('&gt;');
    expect(html).toContain('Small print.<br />');
  });

  it('renders a list when every line is one', () => {
    const html = renderCopyBlock('- first\n- second');

    expect(html.match(/<li /g)).toHaveLength(2);
    expect(html).toContain('<ul ');
  });

  /** A half-list is more likely wrapped prose beginning with a dash than an intentional list. */
  it('reads a mixed chunk as a paragraph rather than a broken list', () => {
    const html = renderCopyBlock('Some lead-in\n- not really a list');

    expect(html).not.toContain('<ul');
  });

  it('renders bold and links', () => {
    const html = renderCopyBlock('A **strong** word and a [link](https://nadeshiko.co).');

    expect(html).toContain('<strong>strong</strong>');
    expect(html).toContain('<a href="https://nadeshiko.co"');
  });

  /**
   * THE ONE THAT MATTERS. This output is interpolated raw, so a `<` that
   * survived would be markup in somebody's inbox rather than a character.
   */
  it('escapes anything that looks like markup', () => {
    const html = renderCopyBlock('An <img src=x onerror=alert(1)> in the copy.');

    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
  });

  it('escapes inside a list item and a link label too', () => {
    expect(renderCopyBlock('- <b>bold</b>')).toContain('&lt;b&gt;');
    expect(renderCopyBlock('[<b>x</b>](https://n.co)')).toContain('&lt;b&gt;');
  });

  /** Preserve template variables for the later `renderTemplate` substitution; escaping braces would show
   * `{{username}}` to the reader. */
  it('leaves template variables alone for the template to fill in', () => {
    expect(renderCopyBlock('Hello {{username}}.')).toContain('{{username}}');
  });
});

describe('parseCopy', () => {
  it('splits on the block headings and keeps the order of the file', () => {
    const blocks = parseCopy('## one\nFirst.\n\n## two\nSecond.');

    expect(Object.keys(blocks)).toEqual(['one', 'two']);
    expect(blocks.one).toContain('First.');
    expect(blocks.two).toContain('Second.');
  });

  it('allows a dotted name, so a block can belong to a section', () => {
    expect(Object.keys(parseCopy('## news.reply\nText.'))).toEqual(['news.reply']);
  });

  /** `###` is a heading inside a block, not a new block. */
  it('does not mistake a section heading for a block', () => {
    const blocks = parseCopy('## only\n### A heading\nBody.');

    expect(Object.keys(blocks)).toEqual(['only']);
  });
});

describe('the copy files themselves', () => {
  const TEMPLATES = ['welcome', 'feedback-ask', 'dormant-30', 'magic-link', 'verify-new-email', 'feedback'];

  /** Derive required template blocks instead of maintaining a list that goes stale. A missing block must not
   * disappear silently during the raw-pass catch-all. */
  it.each(TEMPLATES)('%s has every block its template asks for', async (name) => {
    const template = await readFile(
      join(import.meta.dirname, '..', '..', 'app', 'mailers', 'templates', `${name}.html`),
      'utf-8',
    );
    const required = [...new Set([...template.matchAll(/\{\{\{(copy\.[a-zA-Z.]+)\}\}\}/g)].map((m) => m[1]))];
    const copy = await loadCopy(name);

    expect(required.length).toBeGreaterThan(0);
    expect(required.filter((key) => !(key in copy))).toEqual([]);
  });

  /** The banner is one paragraph in three emails; three copies would drift. */
  it('gives every email the shared Discord block', async () => {
    for (const name of ['welcome', 'feedback-ask', 'dormant-30']) {
      expect(await loadCopy(name)).toHaveProperty('copy.discord');
    }
  });

  /** Local wins, so an email that needs its own wording just declares it. */
  it('lets an email override a shared block', async () => {
    const shared = await loadCopy('magic-link');
    const welcome = await loadCopy('welcome');

    expect(shared['copy.discord']).toBeDefined();
    expect(welcome['copy.discord']).toBeDefined();
  });
});
