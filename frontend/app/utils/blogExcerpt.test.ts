import { describe, expect, it } from 'vitest';
import { blogExcerpt } from './blogExcerpt';

describe('blogExcerpt', () => {
  it('keeps text inside angle brackets, which the HTML version ate', () => {
    // The real regression: the v2.1.0 post advertises `/search <word>` and the
    // card rendered "just type /search " with the argument silently gone.
    const out = blogExcerpt('Just type `/search <word>` in the Discord chat.');
    expect(out).toContain('/search');
    expect(out).not.toContain('<');
  });

  it('does not emit markup, so nothing can nest wrongly', () => {
    const out = blogExcerpt('<div class="image-pair">\n\nSome **bold** and a [link](/media).\n');
    expect(out).not.toMatch(/[<>]/);
    expect(out).toContain('Some bold and a link');
  });

  it('unwraps inline marks and drops headings, images and code fences', () => {
    const out = blogExcerpt(
      ['# Heading', '![alt](/img.png)', '```js', 'const x = 1;', '```', 'Real *body* text.'].join('\n'),
    );
    expect(out).toBe('Real body text.');
  });

  it('flattens bullets into running text', () => {
    // Each bullet used to become its own single-item <ul>, which is why the
    // spacing looked wrong on the index.
    expect(blogExcerpt('- one\n- two\n- three')).toBe('one two three');
  });

  it('strips frontmatter', () => {
    expect(blogExcerpt('---\ntitle: "X"\n---\n\nBody here.')).toBe('Body here.');
  });

  it('truncates on a word boundary', () => {
    const out = blogExcerpt(`${'word '.repeat(200)}end`);
    expect(out.length).toBeLessThanOrEqual(401);
    expect(out.endsWith('…')).toBe(true);
    expect(out).not.toMatch(/wor…$/);
  });

  it('falls back when there is no body, or nothing survives stripping', () => {
    expect(blogExcerpt('', 'the description')).toBe('the description');
    expect(blogExcerpt(null, 'the description')).toBe('the description');
    expect(blogExcerpt('# Only a heading', 'the description')).toBe('the description');
  });
});
