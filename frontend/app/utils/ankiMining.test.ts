import { describe, expect, it } from 'vitest';
import { deckNotesQuery, escapeAnkiTerm, minedNoteQuery, mostCommonModel } from './ankiMining';

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

/**
 * Prefilling the note type from the deck the reader just picked.
 *
 * The vote and the query are here rather than in the store for the reason the
 * rest of this file is: both fail silently. A query that escapes a subdeck's
 * `::` matches nothing and the suggestion never appears; a vote that picks the
 * wrong winner suggests a note type whose fields the reader then has to unpick.
 */
describe('deckNotesQuery', () => {
  it('quotes the whole term and leaves the deck name alone', () => {
    // `::` is the subdeck separator. Escaped, it matches nothing at all, and the
    // reader with a nested mining deck silently never gets a suggestion.
    expect(deckNotesQuery('Japanese::Mining')).toBe('"deck:Japanese::Mining"');
  });

  it('matches the same shape the mined-note probe uses', () => {
    // Both scope by deck, and a reader would rightly expect them to agree about
    // which notes are "in" the deck they picked.
    const probe = minedNoteQuery({ word: '手加減', key: 'Expression', deck: 'Japanese::Mining' });
    expect(probe?.startsWith('"deck:Japanese::Mining"')).toBe(true);
  });

  it('has nothing to ask when no deck is chosen', () => {
    expect(deckNotesQuery('')).toBeNull();
    expect(deckNotesQuery('   ')).toBeNull();
  });
});

describe('mostCommonModel', () => {
  const notes = (...models: Array<string | null | undefined>) => models.map((modelName) => ({ modelName }));

  it('picks the type most of the sample is', () => {
    expect(mostCommonModel(notes('Basic', 'Lapis', 'Lapis', 'Basic', 'Lapis'))).toBe('Lapis');
  });

  it('keeps a handful of strays from outvoting the real answer', () => {
    expect(mostCommonModel(notes(...Array(20).fill('Lapis'), 'Basic', 'Cloze'))).toBe('Lapis');
  });

  it('gives a tie to the type seen first, not the run at the end', () => {
    // A reader midway through switching note types has the new one arriving in a
    // run at the very end of the deck. Tipping a 50/50 on that would suggest the
    // type they have used a handful of times over the one holding the deck.
    expect(mostCommonModel(notes('Lapis', 'Lapis', 'Basic', 'Basic'))).toBe('Lapis');
  });

  it('has no answer for an empty or model-less sample', () => {
    expect(mostCommonModel([])).toBeNull();
    expect(mostCommonModel(notes(null, undefined, ''))).toBeNull();
  });
});
