import { describe, it, expect } from 'vitest';
import { withoutNameEntries } from './shirabeNames';

const word = (id: string, dictionary: string) => ({ id, dictionary });

describe('withoutNameEntries', () => {
  // きみ is the case this exists for: twelve candidates, six of them people
  // called Kimi, every one glossing "Kimi" and indistinguishable in a picker.
  it('drops the name entries and keeps the words, in order', () => {
    const kept = withoutNameEntries([
      word('君', 'jmdict'),
      word('キミ', 'jmnedict'),
      word('黄身', 'jmdict'),
      word('公', 'jmnedict'),
    ]);

    expect(kept.map((candidate) => candidate.id)).toEqual(['君', '黄身']);
  });

  // The caller reads this the same way it reads a token that resolved to
  // nothing, because it is the same answer: no word here to define.
  it('empties a list that was all names', () => {
    expect(withoutNameEntries([word('キミ', 'jmnedict'), word('公', 'jmnedict')])).toEqual([]);
  });

  it('leaves a list with no names untouched', () => {
    const words = [word('猫', 'jmdict'), word('ねこ', 'sanseido')];

    expect(withoutNameEntries(words)).toEqual(words);
  });

  // A candidate from a reader's own stacked dictionary carries its own slug, and
  // an absent one must not be mistaken for a name.
  it('keeps a candidate whose dictionary is unknown or absent', () => {
    expect(withoutNameEntries([{ id: 'x' }, word('y', 'wikipedia')])).toHaveLength(2);
  });
});

// The flag Shirabe publishes, which is the only reliable test: JMdict carries
// ~7,300 JMnedict rows under its own slug, so `dictionary` alone keeps every one
// of them and never says so.
describe('withoutNameEntries with the published flag', () => {
  it('trusts name over the dictionary slug', () => {
    const kept = withoutNameEntries([
      { id: 'とき', dictionary: 'jmdict', name: true }, // the Shinkansen, filed under jmdict
      { id: '時', dictionary: 'jmdict', name: false },
    ]);

    expect(kept.map((candidate) => candidate.id)).toEqual(['時']);
  });

  // A word whose entry happens to sit in jmnedict is still a word if Shirabe
  // says so; the flag wins in both directions.
  it('keeps a non-name even when the slug says jmnedict', () => {
    expect(withoutNameEntries([{ id: 'x', dictionary: 'jmnedict', name: false }])).toHaveLength(1);
  });

  it('falls back to the slug when the flag is absent', () => {
    const kept = withoutNameEntries([
      { id: 'a', dictionary: 'jmnedict' },
      { id: 'b', dictionary: 'jmdict' },
    ]);

    expect(kept.map((candidate) => candidate.id)).toEqual(['b']);
  });
});
