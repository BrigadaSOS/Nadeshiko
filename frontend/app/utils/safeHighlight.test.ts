import { describe, expect, it } from 'vitest';
import { escapeCorpusText, safeHighlight } from './safeHighlight';

describe('safeHighlight', () => {
  it('escapes raw corpus HTML', () => {
    expect(escapeCorpusText('<em>not a highlight</em> & text')).toBe('&lt;em&gt;not a highlight&lt;/em&gt; &amp; text');
  });

  it('retains only the highlighter markup', () => {
    expect(safeHighlight('<em>match</em><span class="highlight-tail">tail</span>')).toBe(
      '<em>match</em><span class="highlight-tail">tail</span>',
    );
  });

  it('does not retain attributes or other elements masquerading as highlights', () => {
    expect(safeHighlight('<em onclick="alert(1)">x</em><span class="other">y</span>')).toBe(
      '&lt;em onclick=&quot;alert(1)&quot;&gt;x</em>&lt;span class=&quot;other&quot;&gt;y</span>',
    );
  });
});
