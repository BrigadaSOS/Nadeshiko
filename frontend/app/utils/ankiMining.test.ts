import { describe, expect, it } from 'vitest';
import { escapeAnkiTerm, minedNoteQuery } from './ankiMining';

describe('escapeAnkiTerm', () => {
  it('leaves an ordinary Japanese word alone', () => {
    expect(escapeAnkiTerm('手加減')).toBe('手加減');
  });

  it('escapes the characters Anki reads as search syntax', () => {
    expect(escapeAnkiTerm('a*b_c"d:e')).toBe('a\\*b\\_c\\"d\\:e');
  });

  it('does not escape the backslashes it just added', () => {
    // A chain of replaces would turn `*` into `\*` and then `\\*`, which Anki
    // reads as a literal backslash followed by a wildcard -- matching nothing,
    // silently.
    expect(escapeAnkiTerm('\\*')).toBe('\\\\\\*');
  });
});

describe('minedNoteQuery', () => {
  it('matches the word exactly, or with a furigana bracket after it', () => {
    // Both shapes are the same mined word: readers whose note type carries
    // furigana in the expression field have `手加減[てかげん]` in it.
    expect(minedNoteQuery({ word: '手加減', key: 'Word', deck: 'Mining' })).toBe(
      '"deck:Mining" ("Word:手加減" OR "Word:手加減[*")',
    );
  });

  it('does not match a word merely containing this one', () => {
    // The point of exact-or-furigana over `*手*`. Asserted on the query string
    // because that is where the mistake would live: a leading wildcard would
    // make every short word look mined.
    const query = minedNoteQuery({ word: '手', key: 'Word' });
    expect(query).not.toContain('*手');
  });

  it('omits the deck scope when the profile has none', () => {
    expect(minedNoteQuery({ word: '食べる', key: 'Expression' })).toBe(
      '("Expression:食べる" OR "Expression:食べる[*")',
    );
  });

  it('leaves subdeck separators intact', () => {
    // `::` is how Anki names a subdeck. Escaping the colons would turn a real
    // deck into a literal string that matches nothing.
    expect(minedNoteQuery({ word: '猫', key: 'Word', deck: 'Japanese::Mining' })).toContain('"deck:Japanese::Mining"');
  });

  it('escapes the word but not the deck', () => {
    const query = minedNoteQuery({ word: 'a:b', key: 'Word', deck: 'My "Deck"' });
    expect(query).toBe('"deck:My "Deck"" ("Word:a\\:b" OR "Word:a\\:b[*")');
  });

  it('has nothing to ask without an expression field', () => {
    // A profile can export perfectly well and still not name the field that
    // holds the word -- it is optional in settings. Null is the caller's cue to
    // skip the check rather than to query for everything.
    expect(minedNoteQuery({ word: '猫', deck: 'Mining' })).toBeNull();
    expect(minedNoteQuery({ word: '猫', key: '   ', deck: 'Mining' })).toBeNull();
  });

  it('has nothing to ask about an empty word', () => {
    expect(minedNoteQuery({ word: '  ', key: 'Word' })).toBeNull();
  });
});
