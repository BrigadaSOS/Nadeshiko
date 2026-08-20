import { describe, it, expect } from 'vitest';
import { htmlToPlainText } from '@app/mailers/plainText';
import { buildMagicLinkEmail, buildOnboardingDay7Email } from '@app/mailers/emailTemplates';

describe('htmlToPlainText', () => {
  it('drops the stylesheet rather than reading it out', () => {
    const html = '<head><style>body { color: red; }</style></head><body><p>Hello</p></body>';

    expect(htmlToPlainText(html)).toBe('Hello');
  });

  /**
   * The reason this is not `replace(/<[^>]+>/g, '')`. Dropping the href leaves
   * "Sign in to Nadeshiko" as dead words — for a magic link, an email that
   * cannot be acted on at all.
   */
  it('keeps the link target beside its text', () => {
    const html = '<a href="https://nadeshiko.co/x?t=1">Sign in</a>';

    expect(htmlToPlainText(html)).toBe('Sign in (https://nadeshiko.co/x?t=1)');
  });

  it('does not print a URL twice when it is its own label', () => {
    const html = '<a href="https://nadeshiko.co/x">https://nadeshiko.co/x</a>';

    expect(htmlToPlainText(html)).toBe('https://nadeshiko.co/x');
  });

  it('strips the mailto: scheme, which is noise to a reader', () => {
    const html = '<a href="mailto:support@nadeshiko.co">support@nadeshiko.co</a>';

    expect(htmlToPlainText(html)).toBe('support@nadeshiko.co');
  });

  it('renders a list as a list', () => {
    const html = '<ul><li><strong>Search:</strong> look things up</li><li>Save them</li></ul>';

    expect(htmlToPlainText(html)).toBe('- Search: look things up\n- Save them');
  });

  /**
   * A blank line between paragraphs, a single break inside one. Plaintext has no
   * other way to show the difference, and running them together is how a
   * generated text part ends up unreadable enough that nobody keeps it.
   */
  it('separates paragraphs but not the lines inside them', () => {
    expect(htmlToPlainText('<p>One</p><p>Two<br />Three</p>')).toBe('One\n\nTwo\nThree');
  });

  it('decodes the entities the templates actually use', () => {
    const html = '<p>&copy; 2026 &mdash; a &amp; b &middot; &quot;c&quot; &#039;d&#039; &hellip;</p>';

    expect(htmlToPlainText(html)).toBe('© 2026 — a & b · "c" \'d\' …');
  });

  /**
   * Query strings are HTML-escaped inside an href, and a plaintext reader
   * pasting `&amp;` into a browser gets a different URL than the one we sent.
   */
  it('unescapes an href, so the link still works when pasted', () => {
    const html = '<a href="https://nadeshiko.co/?a=1&amp;b=2">Go</a>';

    expect(htmlToPlainText(html)).toBe('Go (https://nadeshiko.co/?a=1&b=2)');
  });

  it('collapses runs of empty blocks to a single blank line', () => {
    expect(htmlToPlainText('<p>One</p><div></div><div></div><p>Two</p>')).toBe('One\n\nTwo');
  });

  it('handles an empty document without throwing', () => {
    expect(htmlToPlainText('')).toBe('');
  });
});

describe('the plaintext of a real email', () => {
  it('carries the sign-in URL, which is the whole content of that message', async () => {
    const url = 'https://nadeshiko.co/v1/auth/magic-link/verify?token=abc123';
    const { html } = await buildMagicLinkEmail(url);

    const text = htmlToPlainText(html);

    expect(text).toContain(url);
    expect(text).toContain('expires in 15 minutes');
    expect(text).not.toContain('<');
    expect(text).not.toContain('font-family');
  });

  it('carries the unsubscribe link on lifecycle mail', async () => {
    const { html } = await buildOnboardingDay7Email({
      username: 'alice',
      signals: { activityVisible: true, totalSearches: 0, totalExports: 0, hasAnkiProfile: false },
      unsubscribeUrl: 'https://nadeshiko.co/unsubscribe?token=xyz',
    });

    expect(htmlToPlainText(html)).toContain('https://nadeshiko.co/unsubscribe?token=xyz');
  });
});
