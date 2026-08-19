import { describe, it, expect } from 'vitest';
import { distinctNameAnswers, withoutNameEntries } from './shirabeNames';

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

/** A candidate carrying one entry of one sense, with the definitions given. */
const glossed = (...definitions: Array<{ lang: string; text: string }>) => ({
  entries: [{ senses: [{ definitions }] }],
});

const en = (text: string) => ({ lang: 'en', text });
const es = (text: string) => ({ lang: 'es', text });

describe('distinctNameAnswers', () => {
  const DORAEMON = 'Doraemon (manga by Fujiko F. Fujio; media franchise)';

  // The case that prompted this. Two candidates, one jmdict and one jmnedict,
  // saying the identical sentence -- so the card has one thing to show, not a
  // picker of strangers, and "This looks like a name" threw it away.
  it('counts two candidates with the same gloss as one answer', () => {
    expect(
      distinctNameAnswers([
        glossed(en(DORAEMON), es('Doraemon (manga de Fujiko F. Fujio; franquicia mediática)')),
        glossed(en(DORAEMON)),
      ]),
    ).toBe(1);
  });

  // The case the name state exists for, which must keep it: four people, four
  // glosses, and a picker of those is exactly the noise worth collapsing.
  it('counts four different people as four answers', () => {
    expect(
      distinctNameAnswers([glossed(en('Asuka')), glossed(en('Akika')), glossed(en('Asuga')), glossed(en('Haruka'))]),
    ).toBe(4);
  });

  it('counts a lone candidate as one answer', () => {
    expect(distinctNameAnswers([glossed(en('Oda Nobunaga (1534-1582)'))])).toBe(1);
  });

  // Translations of one answer are still one answer. Comparing every string a
  // candidate holds would call these two different and defeat the point.
  it('ignores languages one candidate has and another lacks', () => {
    expect(distinctNameAnswers([glossed(en('Tokyo'), es('Tokio')), glossed(en('Tokyo'))])).toBe(1);
  });

  // No `en` anywhere: the fallback compares what the candidates do have rather
  // than collapsing them all to an empty signature.
  it('falls back to other languages when no English gloss exists', () => {
    expect(distinctNameAnswers([glossed(es('Asuka')), glossed(es('Haruka'))])).toBe(2);
  });

  // An unreadable candidate must never merge with another into "one answer" --
  // that would render a blank card instead of saying it is a name.
  it('refuses to collapse when a candidate has nothing to read', () => {
    expect(distinctNameAnswers([glossed(en(DORAEMON)), { entries: [] }])).toBe(Number.POSITIVE_INFINITY);
    expect(distinctNameAnswers([{}])).toBe(Number.POSITIVE_INFINITY);
  });

  it('treats an empty list as no answers', () => {
    expect(distinctNameAnswers([])).toBe(0);
  });
});
